import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import {
  ICustomerModuleService,
  IPricingModuleService,
  IProductModuleService,
  IStoreModuleService,
  MedusaContainer,
  PricingContext,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  generateEntityId,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { Wishlist } from "../models/wishlist"

/** Container registration name for {@link WishlistService}. */
export const WISHLIST_SERVICE = "wishlistService"

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

type VariantPriceRow = {
  id: string
  title: string | null
  product_id: string
  price_set_id: string | null
}

type CalculatedVariantPrice = {
  amount: number
  currency_code: string
}

type WishlistVariant = NonNullable<
  NonNullable<Wishlist["product"]>["variants"]
>[number]

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
  private container: MedusaContainer
  private customerModuleService: ICustomerModuleService
  private productModuleService: IProductModuleService
  /**
   * Shared knex connection (`__pg_connection__`). Module EntityManagers are
   * not registered on the application container, and registering one as
   * `"manager"` would be injected into every module.
   */
  private pgConnection: Knex

  constructor(container: MedusaContainer) {
    this.container = container
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
   * query, then batch-loads variants and calculated prices. Product title and
   * thumbnail come from the join. Prices use the store's default currency and
   * region plus the customer's groups, matching storefront price calculation.
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
    const wishlists = rows.map((row) => {
      const wishlist = this.toWishlist(row)
      wishlist.product = {
        id: row.joined_product_id ?? row.product_id,
        title: row.product_title,
        thumbnail: row.product_thumbnail,
      }
      return wishlist
    })

    if (wishlists.length) {
      await this.attachCalculatedPrices(wishlists, customerId)
    }

    return wishlists
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

  /**
   * `calculatePrices` filters by price-set id, not variant id. Variants are
   * loaded in one query and priced in one pricing-module call.
   *
   * The pricing module's context is a flat record at the type level, but
   * calculation flattens nested `customer.groups` into `customer.groups.id`,
   * which is the price-list rule attribute.
   */
  private async attachCalculatedPrices(
    wishlists: Wishlist[],
    customerId: string
  ): Promise<void> {
    const productIds = [
      ...new Set(wishlists.map((item) => item.product?.id ?? item.product_id)),
    ]

    const variantRows = (await this.pgConnection("product_variant as v")
      .leftJoin("product_variant_price_set as l", function () {
        this.on("l.variant_id", "=", "v.id").andOnNull("l.deleted_at")
      })
      .whereIn("v.product_id", productIds)
      .whereNull("v.deleted_at")
      .orderBy("v.variant_rank", "asc")
      .orderBy("v.id", "asc")
      .select({
        id: "v.id",
        title: "v.title",
        product_id: "v.product_id",
        price_set_id: "l.price_set_id",
      })) as VariantPriceRow[]

    const priceSetIds = [
      ...new Set(
        variantRows
          .map((row) => row.price_set_id)
          .filter((id): id is string => !!id)
      ),
    ]

    const pricesBySet = priceSetIds.length
      ? await this.calculatePricesForSets(priceSetIds, customerId)
      : new Map<string, CalculatedVariantPrice>()

    const variantsByProduct = new Map<string, WishlistVariant[]>()

    for (const row of variantRows) {
      const variants = variantsByProduct.get(row.product_id) ?? []
      const price = row.price_set_id
        ? pricesBySet.get(row.price_set_id)
        : undefined

      variants.push({
        id: row.id,
        title: row.title,
        calculated_price: price ?? null,
      })
      variantsByProduct.set(row.product_id, variants)
    }

    for (const wishlist of wishlists) {
      if (!wishlist.product) {
        continue
      }

      wishlist.product.variants =
        variantsByProduct.get(wishlist.product.id) ?? []
    }
  }

  private async calculatePricesForSets(
    priceSetIds: string[],
    customerId: string
  ): Promise<Map<string, CalculatedVariantPrice>> {
    const pricingModule = this.container.resolve<IPricingModuleService>(
      Modules.PRICING
    )
    const calculated = await pricingModule.calculatePrices(
      { id: priceSetIds },
      await this.buildPricingContext(customerId)
    )

    const prices = new Map<string, CalculatedVariantPrice>()

    for (const price of calculated) {
      const amount = Number(price.calculated_amount)

      if (
        price.calculated_amount == null ||
        !Number.isFinite(amount) ||
        !price.currency_code
      ) {
        continue
      }

      prices.set(price.id, {
        amount,
        currency_code: price.currency_code,
      })
    }

    return prices
  }

  private async buildPricingContext(
    customerId: string
  ): Promise<PricingContext> {
    const [{ currencyCode, regionId }, groupIds] = await Promise.all([
      this.resolveStorePricingDefaults(),
      this.resolveCustomerGroupIds(customerId),
    ])

    const context: Record<string, unknown> = {
      currency_code: currencyCode,
    }

    if (regionId) {
      context.region_id = regionId
    }

    if (groupIds.length) {
      context.customer = {
        groups: groupIds.map((id) => ({ id })),
      }
    }

    return { context: context as PricingContext["context"] }
  }

  private async resolveStorePricingDefaults(): Promise<{
    currencyCode: string
    regionId?: string
  }> {
    const storeModule = this.container.resolve<IStoreModuleService>(
      Modules.STORE
    )
    const [store] = await storeModule.listStores(
      {},
      { take: 1, relations: ["supported_currencies"] }
    )

    return {
      currencyCode:
        store?.supported_currencies?.find((currency) => currency.is_default)
          ?.currency_code || "usd",
      regionId: store?.default_region_id || undefined,
    }
  }

  private async resolveCustomerGroupIds(customerId: string): Promise<string[]> {
    try {
      const customer = await this.customerModuleService.retrieveCustomer(
        customerId,
        { relations: ["groups"] }
      )

      return (customer.groups ?? [])
        .map((group) => group.id)
        .filter((id): id is string => !!id)
    } catch (error) {
      if (
        error instanceof MedusaError &&
        error.type === MedusaError.Types.NOT_FOUND
      ) {
        return []
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
