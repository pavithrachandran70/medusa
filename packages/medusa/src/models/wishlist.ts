import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from "@medusajs/framework/mikro-orm/core"

/**
 * Wishlist row. Customer and product ids are text (`cus_`, `prod_`), matching
 * the customer and product tables, so the foreign keys are text columns rather
 * than uuid. Those models live in their own modules and are not MikroORM
 * entities in this package; the foreign keys are declared in the migration.
 */
@Entity({ tableName: "wishlist" })
@Unique({ properties: ["customer_id", "product_id"] })
export class Wishlist {
  @PrimaryKey({ columnType: "text" })
  id!: string

  @Property({ columnType: "text" })
  customer_id!: string

  @Property({ columnType: "text" })
  product_id!: string

  @Property({
    columnType: "timestamptz",
    onCreate: () => new Date(),
  })
  created_at!: Date

  @Property({
    columnType: "timestamptz",
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updated_at!: Date

  /**
   * Populated by `WishlistService.listWishlistItems`. Title and thumbnail come
   * from one product join. Variants and `calculated_price` are attached in a
   * second batch, not one query per wishlist row.
   */
  product?: {
    id: string
    title?: string | null
    thumbnail?: string | null
    variants?: {
      id: string
      title?: string | null
      calculated_price: {
        amount: number
        currency_code: string
      } | null
    }[]
  }
}
