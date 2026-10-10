export type SupaProduct = {
  barcode: string;
  name: string | null;
  category: string | null;
  purchase_price: number | null;
  sale_price: number | null;
  stock: number | null;
  updated_at?: string;
  image_url?: string | null;
  gallery?: string[] | null;
  featured?: boolean | null;
  description?: string | null;
  /** Producto que se vende por peso: sale_price es el precio POR KG. */
  by_weight?: boolean | null;
  measurement_unit?: string | null;
  measurement_value?: number | null;
  suggested_price?: number | null;
  offer_price?: number | null;
  /** Fin de la oferta; NULL = sin fecha de término. */
  offer_ends_at?: string | null;
  is_active?: boolean | null;
  min_stock?: number | null;
  optimum_stock?: number | null;
};

export type ProductUI = {
  /** Es el barcode: el identificador de negocio del producto. */
  id: string;
  name: string;
  price: number;
  image: string;
  slug: string;
  description: string;
  categories: string[];
  stock: number;
  featured?: boolean;
  /** Se vende por peso (kg). `price` pasa a ser precio por kilo. */
  byWeight?: boolean;
  measurementUnit?: string;
  measurementValue?: number;
  suggestedPrice?: number;
  offerPrice?: number;
  /** Fin de la oferta (ISO). null/ausente = la oferta no vence. */
  offerEndsAt?: string | null;
  isActive?: boolean;
  barcode?: string;
  purchasePrice?: number;
  minStock?: number;
  optimumStock?: number;
  updatedAt?: string;
  /**
   * El costo lo fija un proveedor (`product_suppliers`): la ficha lo muestra
   * sólo para mirar. Sólo viene para ADMIN.
   */
  costoProveedor?: boolean;
};

// ── Multi-sucursal ──────────────────────────────────────────────
export interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
