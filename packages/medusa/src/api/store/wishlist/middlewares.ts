import {
  authenticate,
  MiddlewareRoute,
  validateAndTransformBody,
} from "@medusajs/framework/http"
import { StoreAddWishlistItemSchema } from "./validators"

/**
 * `/store/*` authenticates customers as optional. Wishlist routes require one,
 * so a request without session or bearer credentials is rejected with 401.
 */
export const storeWishlistRoutesMiddlewares: MiddlewareRoute[] = [
  {
    method: ["GET", "POST"],
    matcher: "/store/wishlist",
    middlewares: [authenticate("customer", ["session", "bearer"])],
  },
  {
    method: ["POST"],
    matcher: "/store/wishlist",
    middlewares: [validateAndTransformBody(StoreAddWishlistItemSchema)],
  },
  {
    method: ["DELETE"],
    matcher: "/store/wishlist/:product_id",
    middlewares: [authenticate("customer", ["session", "bearer"])],
  },
]
