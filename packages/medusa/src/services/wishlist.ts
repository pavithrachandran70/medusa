import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import {
  ICustomerModuleService,
  IProductModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  generateEntityId,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { Wishlist } from "../models/wishlist"

type WishlistRow = {
  id: string
  customer_id: string
  product_id: string
  created_at: Date
  updated_at: Date
  joined_product_id?: string | null
  product_title?: string | null
  product_thumbnail?: string | null
}

const UNIQUE_CONSTRAINT = "wishlist_customer_product_unique"

/**
 * PostgreSQL unique violations surface as `23505`. Knex sometimes nests the
 * driver error, so walk `cause` as well as the constraint name.
 */
const isUniqueViolation = (error: unknown): boolean => {
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    const record = current as {
      code?: string
      constraint?: string
      cause?: unknown
    }

    if (record.code === "23505" || record.constraint === UNIQUE_CONSTRAINT) {
      return true
    }

    current = record.cause
  }

  return false
}

export class WishlistService {
  private customerModuleService: ICustomerModuleService
  private productModuleService: IProductModuleService
  /**
   * Shared knex connection (`__pg_connection__`). Module EntityManagers are
   * not registered on the application container, and registering one as
   * `"manager"` would be injected into every module.
   */
  private pgConnection: Knex

  constructor(container: MedusaContainer) {
    this.customerModuleService = container.resolve(Modules.CUSTOMER)
    this.productModuleService = container.resolve(Modules.PRODUCT)
    this.pgConnection = container.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    )
  }

  async addToWishlist(
    customerId: string,
    productId: string
  ): Promise<Wishlist> {
    await this.retrieveCustomer(customerId)
    await this.retrieveProduct(productId)

    const now = new Date()

    try {
      const inserted = await this.pgConnection("wishlist")
        .insert({
          id: generateEntityId(undefined, "wish"),
          customer_id: customerId,
          product_id: productId,
          created_at: now,
          updated_at: now,
        })
        .returning("*")

      return this.toWishlist(inserted[0])
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByCustomerAndProduct(
          customerId,
          productId
        )

        if (existing) {
          return existing
        }
      }

      throw error
    }
  }

  async removeFromWishlist(
    customerId: string,
    productId: string
  ): Promise<void> {
    await this.pgConnection("wishlist")
      .where({
        customer_id: customerId,
        product_id: productId,
      })
      .delete()
  }

  /**
   * Loads every wishlist row for the customer and the related product in one
   * query. Product title and thumbnail come from the join, so listing does
   * not issue a follow-up query per item.
   */
  async listWishlistItems(customerId: string): Promise<Wishlist[]> {
    const result = await this.pgConnection.raw(
      `SELECT
        w."id",
        w."customer_id",
        w."product_id",
        w."created_at",
        w."updated_at",
        p."id" AS "joined_product_id",
        p."title" AS "product_title",
        p."thumbnail" AS "product_thumbnail"
      FROM "wishlist" w
      INNER JOIN "product" p ON p."id" = w."product_id" AND p."deleted_at" IS NULL
      WHERE w."customer_id" = ?`,
      [customerId]
    )

    const rows = (result.rows ?? result) as WishlistRow[]

    return rows.map((row) => {
      const wishlist = this.toWishlist(row)
      wishlist.product = {
        id: row.joined_product_id ?? row.product_id,
        title: row.product_title,
        thumbnail: row.product_thumbnail,
      }
      return wishlist
    })
  }

  private async retrieveCustomer(customerId: string) {
    try {
      const customer =
        await this.customerModuleService.retrieveCustomer(customerId)

      if (!customer) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Customer with id ${customerId} not found`
        )
      }

      return customer
    } catch (error) {
      if (
        error instanceof MedusaError &&
        error.type === MedusaError.Types.NOT_FOUND
      ) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Customer with id ${customerId} not found`
        )
      }

      throw error
    }
  }

  private async retrieveProduct(productId: string) {
    try {
      const product = await this.productModuleService.retrieveProduct(productId)

      if (!product) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Product with id ${productId} not found`
        )
      }

      return product
    } catch (error) {
      if (
        error instanceof MedusaError &&
        error.type === MedusaError.Types.NOT_FOUND
      ) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Product with id ${productId} not found`
        )
      }

      throw error
    }
  }

  private async findByCustomerAndProduct(
    customerId: string,
    productId: string
  ): Promise<Wishlist | null> {
    const row = await this.pgConnection("wishlist")
      .where({
        customer_id: customerId,
        product_id: productId,
      })
      .first()

    return row ? this.toWishlist(row) : null
  }

  private toWishlist(row: WishlistRow): Wishlist {
    const wishlist = new Wishlist()
    wishlist.id = row.id
    wishlist.customer_id = row.customer_id
    wishlist.product_id = row.product_id
    wishlist.created_at = row.created_at
    wishlist.updated_at = row.updated_at
    return wishlist
  }
}
