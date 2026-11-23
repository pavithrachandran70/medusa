import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  WISHLIST_SERVICE,
  WishlistService,
} from "../../../../services/wishlist"

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const customerId = req.auth_context.actor_id
  const { product_id } = req.params

  const wishlistService = req.scope.resolve<WishlistService>(WISHLIST_SERVICE)
  await wishlistService.removeFromWishlist(customerId, product_id)

  res.status(200).json({ deleted: true, id: product_id })
}
