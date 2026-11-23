import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  WISHLIST_SERVICE,
  WishlistService,
} from "../../../../../services/wishlist"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { customer_id } = req.params

  const wishlistService = req.scope.resolve<WishlistService>(WISHLIST_SERVICE)
  const wishlistItems = await wishlistService.listWishlistItems(customer_id)

  res.status(200).json({
    wishlist_items: wishlistItems,
    count: wishlistItems.length,
  })
}
