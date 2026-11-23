import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
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

    beforeAll(async () => {
      appContainer = getContainer()
      await createAdminUser(dbConnection, adminHeaders, appContainer)
      const publishableKey = await generatePublishableKey(appContainer)
      storeHeaders = generateStoreHeaders({ publishableKey })

      const result = await createAuthenticatedCustomer(api, storeHeaders, {
        first_name: "Test",
        last_name: "Customer",
        email: "admin-test@wishlist.com",
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
          { name: "wishlist-admin", type: "default" },
          adminHeaders
        )
      ).data.shipping_profile

      product = (
        await api.post(
          "/admin/products",
          {
            title: "Admin Test Product",
            status: "published",
            shipping_profile_id: shippingProfile.id,
            options: [{ title: "Size", values: ["L"] }],
            variants: [
              {
                title: "L",
                sku: "ADMIN-TEST-L",
                options: { Size: "L" },
                manage_inventory: false,
                prices: [{ amount: 2000, currency_code: "usd" }],
              },
            ],
          },
          adminHeaders
        )
      ).data.product

      await api.post(
        `/store/wishlist`,
        { product_id: product.id },
        storeHeadersWithCustomer
      )
    })

    describe("GET /admin/customers/:customer_id/wishlist (Story 2)", () => {
      it("should list wishlist items for a specific customer (AC 2 admin view)", async () => {
        const response = await api.get(
          `/admin/customers/${customer.id}/wishlist`,
          adminHeaders
        )

        expect(response.status).toEqual(200)
        expect(response.data.count).toEqual(1)
        expect(response.data.wishlist_items).toHaveLength(1)
        expect(response.data.wishlist_items[0]).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            customer_id: customer.id,
            product_id: product.id,
          })
        )
      })

      it("should reject an unauthenticated admin request", async () => {
        const { response } = await api
          .get(`/admin/customers/${customer.id}/wishlist`)
          .catch((e) => e)

        expect(response.status).toEqual(401)
      })
    })

    describe("DELETE /admin/customers/:customer_id/wishlist/:product_id (Story 2)", () => {
      it("should remove product from customer's wishlist (AC 3 admin action)", async () => {
        await api.post(
          `/store/wishlist`,
          { product_id: product.id },
          storeHeadersWithCustomer
        )

        const deleteResponse = await api.delete(
          `/admin/customers/${customer.id}/wishlist/${product.id}`,
          adminHeaders
        )

        expect(deleteResponse.status).toEqual(200)
        expect(deleteResponse.data).toEqual({
          deleted: true,
          id: product.id,
        })

        const listResponse = await api.get(
          `/admin/customers/${customer.id}/wishlist`,
          adminHeaders
        )

        expect(listResponse.data.count).toEqual(0)
        expect(listResponse.data.wishlist_items).toHaveLength(0)
      })
    })
  },
})
