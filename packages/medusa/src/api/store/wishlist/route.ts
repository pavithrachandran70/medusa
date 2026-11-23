import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { WISHLIST_SERVICE, WishlistService } from "../../../services/wishlist"
import { StoreAddWishlistItemSchemaType } from "./validators"

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreAddWishlistItemSchemaType>,
  res: MedusaResponse
) => {
  const customerId = req.auth_context.actor_id
  const { product_id } = req.validatedBody

  const wishlistService = req.scope.resolve<WishlistService>(WISHLIST_SERVICE)
  const wishlistItem = await wishlistService.addToWishlist(
    customerId,
    product_id
  )

  res.status(200).json({ wishlist_item: wishlistItem })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const customerId = req.auth_context.actor_id

  const wishlistService = req.scope.resolve<WishlistService>(WISHLIST_SERVICE)
  const wishlistItems = await wishlistService.listWishlistItems(customerId)

  res.status(200).json({
    wishlist_items: wishlistItems,
    count: wishlistItems.length,
  })
}
