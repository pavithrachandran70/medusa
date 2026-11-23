import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"
import { createAuthenticatedCustomer } from "../../../../modules/helpers/create-authenticated-customer"

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

jest.setTimeout(600 * 1000)

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer, api }) => {
    let appContainer
    let storeHeaders
    let storeHeadersWithCustomer
    let customer
    let product
    let secondProduct

    beforeAll(async () => {
      appContainer = getContainer()
      await createAdminUser(dbConnection, adminHeaders, appContainer)
      const publishableKey = await generatePublishableKey(appContainer)
      storeHeaders = generateStoreHeaders({ publishableKey })

      // The runner snapshots the database on the first test. Create the
      // customer, publishable key, and products here so that snapshot still
      // contains them when later tests restore.
      const result = await createAuthenticatedCustomer(api, storeHeaders, {
        first_name: "Test",
        last_name: "User",
        email: "test@wishlist.com",
      })

      customer = result.customer
      storeHeadersWithCustomer = {
        headers: {
          ...storeHeaders.headers,
          authorization: `Bearer ${result.jwt}`,
        },
      }

      const shippingProfile = (
        await api.post(
          `/admin/shipping-profiles`,
          { name: "wishlist", type: "default" },
          adminHeaders
        )
      ).data.shipping_profile

      product = (
        await api.post(
          "/admin/products",
          {
            title: "Test Wishlist Product",
            status: "published",
            shipping_profile_id: shippingProfile.id,
            options: [{ title: "Size", values: ["S"] }],
            variants: [
              {
                title: "S",
                sku: "TEST-WISHLIST-S",
                options: { Size: "S" },
                manage_inventory: false,
                prices: [{ amount: 1000, currency_code: "usd" }],
              },
            ],
          },
          adminHeaders
        )
      ).data.product

      secondProduct = (
        await api.post(
          "/admin/products",
          {
            title: "Second Test Product",
            status: "published",
            shipping_profile_id: shippingProfile.id,
            options: [{ title: "Size", values: ["M"] }],
            variants: [
              {
                title: "M",
                sku: "TEST-WISHLIST-M",
                options: { Size: "M" },
                manage_inventory: false,
                prices: [{ amount: 1500, currency_code: "usd" }],
              },
            ],
          },
          adminHeaders
        )
      ).data.product
    })

    describe("Wishlist Service Layer Tests (Story 1)", () => {
      describe("Service idempotency", () => {
        it("should return the same wishlist item when adding the same product twice", async () => {
          const container = getContainer()
          const wishlistService = container.resolve("wishlistService")
          const customerModule = container.resolve(Modules.CUSTOMER)
          const productModule = container.resolve(Modules.PRODUCT)

          const customer = await customerModule.createCustomers({
            email: "test@example.com",
          })
          const product = await productModule.createProducts({
            title: "Test Product",
            status: "published",
          })

          const firstAdd = await wishlistService.addToWishlist(
            customer.id,
            product.id
          )

          const secondAdd = await wishlistService.addToWishlist(
            customer.id,
            product.id
          )

          expect(secondAdd.id).toEqual(firstAdd.id)

          const connection = container.resolve("dbConnection")
          const result = await connection.raw(
            `SELECT COUNT(*) FROM wishlist WHERE customer_id = ? AND product_id = ?`,
            [customer.id, product.id]
          )
          expect(parseInt(result.rows[0].count)).toEqual(1)
        })
      })

      describe("Cascade delete behavior", () => {
        it("should automatically remove wishlist item when product is deleted", async () => {
          const container = getContainer()
          const wishlistService = container.resolve("wishlistService")
          const customerModule = container.resolve(Modules.CUSTOMER)
          const productModule = container.resolve(Modules.PRODUCT)

          const customer = await customerModule.createCustomers({
            email: "cascade-test@example.com",
          })
          const product = await productModule.createProducts({
            title: "Cascade Test Product",
            status: "published",
          })

          await wishlistService.addToWishlist(customer.id, product.id)

          await productModule.deleteProducts([product.id])

          const items = await wishlistService.listWishlistItems(customer.id)
          expect(items).toHaveLength(0)
        })
      })

      describe("N+1 query prevention", () => {
        it("should eagerly load product relation and avoid N+1 queries", async () => {
          const container = getContainer()
          const wishlistService = container.resolve("wishlistService")
          const customerModule = container.resolve(Modules.CUSTOMER)
          const productModule = container.resolve(Modules.PRODUCT)

          const customer = await customerModule.createCustomers({
            email: "n-plus-one-test@example.com",
          })

          const product1 = await productModule.createProducts({
            title: "Product 1",
            thumbnail: "thumb1.jpg",
            status: "published",
          })
          const product2 = await productModule.createProducts({
            title: "Product 2",
            thumbnail: "thumb2.jpg",
            status: "published",
          })

          await wishlistService.addToWishlist(customer.id, product1.id)
          await wishlistService.addToWishlist(customer.id, product2.id)

          const connection = container.resolve("dbConnection")
          const originalQuery = connection.query?.bind(connection)
          const queries: string[] = []

          if (originalQuery) {
            connection.query = function (...args: any[]) {
              queries.push(args[0])
              return originalQuery(...args)
            }
          }

          const items = await wishlistService.listWishlistItems(customer.id)

          if (originalQuery) {
            connection.query = originalQuery
          }

          expect(items).toHaveLength(2)
          expect(items[0].product).toBeDefined()
          expect(items[0].product.title).toBeDefined()
          expect(items[0].product.thumbnail).toBeDefined()
          expect(items[1].product).toBeDefined()
          expect(items[1].product.title).toBeDefined()
          expect(items[1].product.thumbnail).toBeDefined()

          const selectQueries = queries.filter((q) =>
            String(q).toLowerCase().includes("select")
          )
          expect(selectQueries.length).toBeLessThanOrEqual(2)
        })
      })
    })

    describe("Store wishlist API (Story 2)", () => {
      beforeEach(async () => {
        const connection = getContainer().resolve("dbConnection")
        await connection("wishlist")
          .where({ customer_id: customer.id })
          .delete()
      })

      describe("POST /store/wishlist (Story 2)", () => {
        it("should add a product to authenticated customer's wishlist (AC 1)", async () => {
          const response = await api.post(
            `/store/wishlist`,
            { product_id: product.id },
            storeHeadersWithCustomer
          )

          expect(response.status).toEqual(200)
          expect(response.data.wishlist_item).toEqual(
            expect.objectContaining({
              id: expect.any(String),
              customer_id: customer.id,
              product_id: product.id,
              created_at: expect.any(String),
              updated_at: expect.any(String),
            })
          )
        })

        it("should return the existing item when the product is already saved (AC 4)", async () => {
          const first = await api.post(
            `/store/wishlist`,
            { product_id: product.id },
            storeHeadersWithCustomer
          )
          const second = await api.post(
            `/store/wishlist`,
            { product_id: product.id },
            storeHeadersWithCustomer
          )

          expect(second.status).toEqual(200)
          expect(second.data.wishlist_item.id).toEqual(
            first.data.wishlist_item.id
          )

          const list = await api.get(
            `/store/wishlist`,
            storeHeadersWithCustomer
          )
          expect(list.data.count).toEqual(1)
        })

        it("should reject unauthenticated add request (AC 7)", async () => {
          const { response } = await api
            .post(`/store/wishlist`, { product_id: product.id }, storeHeaders)
            .catch((e) => e)

          expect(response.status).toEqual(401)
        })
      })

      describe("GET /store/wishlist (Story 2)", () => {
        beforeEach(async () => {
          await api.post(
            `/store/wishlist`,
            { product_id: product.id },
            storeHeadersWithCustomer
          )
          await api.post(
            `/store/wishlist`,
            { product_id: secondProduct.id },
            storeHeadersWithCustomer
          )
        })

        it("should list all wishlist items for authenticated customer (AC 2)", async () => {
          const response = await api.get(
            `/store/wishlist`,
            storeHeadersWithCustomer
          )

          expect(response.status).toEqual(200)
          expect(response.data.count).toEqual(2)
          expect(response.data.wishlist_items).toHaveLength(2)
          expect(response.data.wishlist_items[0]).toEqual(
            expect.objectContaining({
              id: expect.any(String),
              customer_id: customer.id,
              product_id: expect.any(String),
            })
          )
        })

        it("should return the same items after the customer signs in again (AC 5)", async () => {
          const signin = await api.post("/auth/customer/emailpass", {
            email: "test@wishlist.com",
            password: "secret_password",
          })
          const signedInAgain = {
            headers: {
              ...storeHeaders.headers,
              authorization: `Bearer ${signin.data.token}`,
            },
          }

          const response = await api.get(`/store/wishlist`, signedInAgain)

          expect(response.status).toEqual(200)
          expect(response.data.count).toEqual(2)
          expect(response.data.wishlist_items).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                customer_id: customer.id,
                product_id: product.id,
              }),
              expect.objectContaining({
                customer_id: customer.id,
                product_id: secondProduct.id,
              }),
            ])
          )
        })
      })

      describe("DELETE /store/wishlist/:product_id (Story 2)", () => {
        beforeEach(async () => {
          await api.post(
            `/store/wishlist`,
            { product_id: product.id },
            storeHeadersWithCustomer
          )
        })

        it("should remove product from wishlist (AC 3)", async () => {
          const deleteResponse = await api.delete(
            `/store/wishlist/${product.id}`,
            storeHeadersWithCustomer
          )

          expect(deleteResponse.status).toEqual(200)
          expect(deleteResponse.data).toEqual({
            deleted: true,
            id: product.id,
          })

          const listResponse = await api.get(
            `/store/wishlist`,
            storeHeadersWithCustomer
          )

          expect(listResponse.data.count).toEqual(0)
          expect(listResponse.data.wishlist_items).toHaveLength(0)
        })
      })

      it("should return an empty list when the customer has no items (AC 6)", async () => {
        const response = await api.get(
          `/store/wishlist`,
          storeHeadersWithCustomer
        )

        expect(response.status).toEqual(200)
        expect(response.data).toEqual({
          wishlist_items: [],
          count: 0,
        })
      })
    })
  },
})
