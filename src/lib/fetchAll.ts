import { supabase } from "@/integrations/supabase/client";

const PAGE = 1000;

/**
 * Fetch ALL rows from a table, paging past Supabase's 1000-row default limit.
 * Pass a `select` string to control columns/joins (defaults to "*").
 * Optional `order` column for stable pagination.
 */
export async function fetchAll<T = any>(
  table: string,
  select: string = "*",
  order?: { column: string; ascending?: boolean }
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = (supabase as any).from(table).select(select).range(from, from + PAGE - 1);
    if (order) q = q.order(order.column, { ascending: order.ascending ?? true });
    const { data, error } = await q;
    if (error) throw error;
    const batch = (data || []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
