/** The client's categories as select options, grouped under Works, Services and Goods & Supplies. */
import type { Category } from '../lib/queries.ts';

/** <option>s for a category select, in one <optgroup> per procurement type, in the order staff set. */
export function CategoryOptions({ categories }: { categories: Category[] }) {
  const types = [...new Set(categories.map((category) => category.procurement_type ?? 'Other'))];
  return (
    <>
      {types.map((type) => (
        <optgroup key={type} label={type}>
          {categories
            .filter((category) => (category.procurement_type ?? 'Other') === type)
            .map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
