import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";

export const ADMIN_EMAIL = "sustacek.adam@gmail.com";

type AuthCtx = QueryCtx | MutationCtx;

export async function requireUserId(ctx: AuthCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Authentication required");
  return userId;
}

export async function requireAdmin(ctx: AuthCtx) {
  const userId = await requireUserId(ctx);
  const user = await ctx.db.get(userId);
  const email = (user as { email?: string } | null)?.email;
  if (!email || email.trim().toLowerCase() !== ADMIN_EMAIL) {
    throw new Error("Admin access required");
  }
  return userId;
}

export const requireUserForAction = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => await requireUserId(ctx),
});

export const requireAdminForAction = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => await requireAdmin(ctx),
});
