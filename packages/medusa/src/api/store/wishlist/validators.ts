import { z } from "@medusajs/framework/zod"

export const StoreAddWishlistItemSchema = z.object({
  product_id: z.string(),
})

export type StoreAddWishlistItemSchemaType = z.infer<
  typeof StoreAddWishlistItemSchema
>

export const StoreGetWishlistSchema = z.object({})

export type StoreGetWishlistSchemaType = z.infer<typeof StoreGetWishlistSchema>
