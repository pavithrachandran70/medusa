import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/utils"
import {
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../helpers/create-admin-user"

const env = {}
const adminHeaders = { headers: { "x-medusa-access-token": "test_token" } }

jest.setTimeout(600 * 1000)

medusaIntegrationTestRunner({
  env,
  testSuite: ({ dbConnection, getContainer }) => {
    let appContainer

    beforeAll(async () => {
      appContainer = getContainer()
      await createAdminUser(dbConnection, adminHeaders, appContainer)
      const publishableKey = await generatePublishableKey(appContainer)
      generateStoreHeaders({ publishableKey })
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
  },
})
