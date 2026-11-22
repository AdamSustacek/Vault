import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server"
import { ConvexError, v } from "convex/values"
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import { ADMIN_EMAIL, requireAdmin } from "./authz"
import type { Id } from "./_generated/dataModel"

// Sign-in identifiers are usernames. Convex Auth stores credentials under an
// account id, so the username is mapped to an internal, non-deliverable address.
const USERNAME_DOMAIN = "vault.local"
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function usernameToEmail(username: string): string {
  return `${username}@${USERNAME_DOMAIN}`
}

export const listAccounts = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("users"),
      username: v.union(v.string(), v.null()),
      isAdmin: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const users = await ctx.db.query("users").collect()
    return users
      .filter((user) => typeof user.username === "string")
      .map((user) => ({
        id: user._id,
        username: user.username ?? null,
        isAdmin: (user.email ?? "").trim().toLowerCase() === ADMIN_EMAIL,
      }))
      .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || (a.username ?? "").localeCompare(b.username ?? ""))
  },
})

export const debugUsers = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      email: v.union(v.string(), v.null()),
      username: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect()
    return users.map((user) => ({
      email: user.email ?? null,
      username: user.username ?? null,
    }))
  },
})

export const findUserByUsername = internalQuery({
  args: { username: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first()
    return user?._id ?? null
  },
})

export const adminExists = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", ADMIN_EMAIL))
      .first()
    return Boolean(user)
  },
})

export const createGuest = action({
  args: { username: v.string(), password: v.string() },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.authz.requireAdminForAction, {})

    const username = normalizeUsername(args.username)
    if (!USERNAME_PATTERN.test(username)) throw new ConvexError("USERNAME_INVALID")
    if (args.password.length < 8) throw new ConvexError("PASSWORD_TOO_SHORT")

    const existing = await ctx.runQuery(internal.accounts.findUserByUsername, { username })
    if (existing) throw new ConvexError("USERNAME_TAKEN")

    try {
      const { user } = await createAccount(ctx, {
        provider: "password",
        account: { id: usernameToEmail(username), secret: args.password },
        profile: { email: usernameToEmail(username), name: username },
      })
      await ctx.runMutation(internal.accounts.setUsername, {
        userId: user._id,
        username,
      })
      return user._id
    } catch {
      throw new ConvexError("USERNAME_TAKEN")
    }
  },
})

export const setUsername = internalMutation({
  args: { userId: v.id("users"), username: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { username: args.username })
    return null
  },
})

export const getPasswordAccount = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.userId).eq("provider", "password"),
      )
      .first()
    return account?.providerAccountId ?? null
  },
})

export const renamePasswordAccount = internalMutation({
  args: { userId: v.id("users"), username: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.userId).eq("provider", "password"),
      )
      .first()
    if (account) {
      await ctx.db.patch(account._id, { providerAccountId: usernameToEmail(args.username) })
    }
    await ctx.db.patch(args.userId, { username: args.username })
    return null
  },
})

export const getAccountForDeletion = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.object({ isAdmin: v.boolean() }), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId)
    if (!user) return null
    return { isAdmin: (user.email ?? "").trim().toLowerCase() === ADMIN_EMAIL }
  },
})

async function removeUserRows(ctx: MutationCtx, userId: Id<"users">) {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect()
  for (const account of accounts) await ctx.db.delete(account._id)

  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect()
  for (const session of sessions) {
    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect()
    for (const token of refreshTokens) await ctx.db.delete(token._id)
    await ctx.db.delete(session._id)
  }

  const user = await ctx.db.get(userId)
  if (user) await ctx.db.delete(userId)
}

export const removeAccountRows = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await removeUserRows(ctx, args.userId)
    return null
  },
})

export const deleteAccount = action({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adminId: Id<"users"> = await ctx.runQuery(internal.authz.requireAdminForAction, {})
    if (args.userId === adminId) throw new ConvexError("CANNOT_DELETE_SELF")

    const target = await ctx.runQuery(internal.accounts.getAccountForDeletion, {
      userId: args.userId,
    })
    if (!target) return null
    if (target.isAdmin) throw new ConvexError("CANNOT_DELETE_ADMIN")

    await invalidateSessions(ctx, { userId: args.userId })
    await ctx.runMutation(internal.accounts.removeAccountRows, { userId: args.userId })
    return null
  },
})

export const updateAccount = action({
  args: {
    userId: v.id("users"),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adminId: Id<"users"> = await ctx.runQuery(internal.authz.requireAdminForAction, {})

    const target = await ctx.runQuery(internal.accounts.getAccountForDeletion, {
      userId: args.userId,
    })
    if (!target) throw new ConvexError("ACCOUNT_NOT_FOUND")

    const nextUsername = args.username ? normalizeUsername(args.username) : undefined
    if (nextUsername) {
      if (!USERNAME_PATTERN.test(nextUsername)) throw new ConvexError("USERNAME_INVALID")
      const taken = await ctx.runQuery(internal.accounts.findUserByUsername, {
        username: nextUsername,
      })
      if (taken && taken !== args.userId) throw new ConvexError("USERNAME_TAKEN")
    }
    if (args.password !== undefined && args.password.length < 8) {
      throw new ConvexError("PASSWORD_TOO_SHORT")
    }

    const accountId = await ctx.runQuery(internal.accounts.getPasswordAccount, {
      userId: args.userId,
    })

    if (nextUsername && accountId !== usernameToEmail(nextUsername)) {
      await ctx.runMutation(internal.accounts.renamePasswordAccount, {
        userId: args.userId,
        username: nextUsername,
      })
    }

    if (args.password) {
      if (!accountId && !nextUsername) throw new ConvexError("NO_PASSWORD_ACCOUNT")
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: {
          id: nextUsername ? usernameToEmail(nextUsername) : accountId!,
          secret: args.password,
        },
      })
      if (args.userId !== adminId) {
        await invalidateSessions(ctx, { userId: args.userId })
      }
    }

    return null
  },
})

export const changeMyPassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId: Id<"users"> = await ctx.runQuery(internal.authz.requireUserForAction, {})
    if (args.newPassword.length < 8) throw new ConvexError("PASSWORD_TOO_SHORT")

    const accountId = await ctx.runQuery(internal.accounts.getPasswordAccount, { userId })
    if (!accountId) throw new ConvexError("NO_PASSWORD_ACCOUNT")

    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: accountId, secret: args.currentPassword },
      })
    } catch {
      throw new ConvexError("WRONG_PASSWORD")
    }

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: accountId, secret: args.newPassword },
    })
    return null
  },
})

/**
 * One-time bootstrap for the owner account. It only runs while the admin has no
 * username/password account yet, so it cannot take over an initialized app.
 */
export const seedAdmin = internalMutation({
  args: { username: v.string(), password: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", ADMIN_EMAIL))
      .first()
    if (existing && existing.username) return false
    if (existing) {
      // The admin user from the earlier sign-in method has no username account.
      await removeUserRows(ctx, existing._id)
    }

    const username = normalizeUsername(args.username)
    if (!USERNAME_PATTERN.test(username)) throw new Error("Invalid username")
    if (args.password.length < 8) throw new Error("Password too short")

    // Drop password accounts created before usernames were persisted.
    const users = await ctx.db.query("users").collect()
    for (const user of users) {
      const isPasswordAccount = (user.email ?? "").endsWith(`@${USERNAME_DOMAIN}`)
      if (isPasswordAccount && !user.username) await removeUserRows(ctx, user._id)
    }

    // createAccount only reads and writes the database, so a mutation context is safe here.
    const { user } = await createAccount(ctx as unknown as ActionCtx, {
      provider: "password",
      account: { id: usernameToEmail(username), secret: args.password },
      profile: { email: ADMIN_EMAIL, name: "Adam" },
    })
    await ctx.db.patch(user._id, { username })
    return true
  },
})