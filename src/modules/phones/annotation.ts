/**
 * One JSON patch for «Поставщик» and «Категория».
 * Other keys stay. An empty next value deletes that key.
 * A non-empty value counts as updated even when the text is unchanged.
 */

import { CATEGORY_FIELD, readCategory } from "@/modules/phones/category";
import { SUPPLIER_FIELD, readSupplier } from "@/modules/phones/supplier";

export type AnnotationOutcome = "updated" | "cleared" | "unchanged";

export type AnnotationPatch = {
  data: Record<string, unknown>;
  write: boolean;
  supplier: AnnotationOutcome;
  category: AnnotationOutcome;
};

function cloneData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return { ...(data as Record<string, unknown>) };
}

function outcome(previous: string, next: string): AnnotationOutcome {
  if (next) return "updated";
  if (previous !== next) return "cleared";
  return "unchanged";
}

export function applyPhoneAnnotation(
  data: unknown,
  next: { supplier: string; category: string },
): AnnotationPatch {
  const supplier = next.supplier.trim();
  const category = next.category.trim();
  const previousSupplier = readSupplier(data);
  const previousCategory = readCategory(data);
  const cloned = cloneData(data);
  if (supplier) cloned[SUPPLIER_FIELD] = supplier;
  else delete cloned[SUPPLIER_FIELD];
  if (category) cloned[CATEGORY_FIELD] = category;
  else delete cloned[CATEGORY_FIELD];
  return {
    data: cloned,
    write: previousSupplier !== supplier || previousCategory !== category,
    supplier: outcome(previousSupplier, supplier),
    category: outcome(previousCategory, category),
  };
}
