import { asValue } from "@medusajs/framework/awilix"
import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CREATE_WISHLIST_CUSTOMER_INDEX_SQL,
  CREATE_WISHLIST_PRODUCT_INDEX_SQL,
  CREATE_WISHLIST_TABLE_SQL,
} from "../migrations/20261123120000-CreateWishlistTable"
import { WISHLIST_SERVICE, WishlistService } from "../services/wishlist"

/**
 * Creates the wishlist table when core module migrations have already created
 * `customer` and `product`, then registers `wishlistService` for the app
 * container. `dbConnection` is the shared knex handle used by service tests.
 */
export async function loadWishlist(container: MedusaContainer): Promise<void> {
  const pgConnection = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as Knex

  const hasWishlistTable = await pgConnection.schema.hasTable("wishlist")

  if (!hasWishlistTable) {
    await pgConnection.raw(CREATE_WISHLIST_TABLE_SQL)
    await pgConnection.raw(CREATE_WISHLIST_CUSTOMER_INDEX_SQL)
    await pgConnection.raw(CREATE_WISHLIST_PRODUCT_INDEX_SQL)
  }

  container.register({
    [WISHLIST_SERVICE]: asValue(new WishlistService(container)),
    dbConnection: asValue(pgConnection),
  })
}
