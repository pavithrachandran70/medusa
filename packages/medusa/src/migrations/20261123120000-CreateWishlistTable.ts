import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Customer and product primary keys are text. The foreign keys use the same
 * type so `ON DELETE CASCADE` can reference `customer` and `product`.
 */
export const CREATE_WISHLIST_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "wishlist" (
  "id" text NOT NULL,
  "customer_id" text NOT NULL,
  "product_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wishlist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wishlist_customer_id_foreign" FOREIGN KEY ("customer_id") REFERENCES "customer" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "wishlist_product_id_foreign" FOREIGN KEY ("product_id") REFERENCES "product" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "wishlist_customer_product_unique" UNIQUE ("customer_id", "product_id")
)`

export const CREATE_WISHLIST_CUSTOMER_INDEX_SQL = `CREATE INDEX IF NOT EXISTS "wishlist_customer_id_index" ON "wishlist" ("customer_id")`

export const CREATE_WISHLIST_PRODUCT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS "wishlist_product_id_index" ON "wishlist" ("product_id")`

export const DROP_WISHLIST_TABLE_SQL = `DROP TABLE IF EXISTS "wishlist" CASCADE`

export class CreateWishlistTable extends Migration {
  async up(): Promise<void> {
    this.addSql(CREATE_WISHLIST_TABLE_SQL)
    this.addSql(CREATE_WISHLIST_CUSTOMER_INDEX_SQL)
    this.addSql(CREATE_WISHLIST_PRODUCT_INDEX_SQL)
  }

  async down(): Promise<void> {
    this.addSql(DROP_WISHLIST_TABLE_SQL)
  }
}
