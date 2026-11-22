"use client";

import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function describeError(caught: unknown): string {
  const code =
    caught instanceof ConvexError && typeof caught.data === "string" ? caught.data : null;
  if (code === "USERNAME_INVALID") {
    return "Uživatelské jméno musí mít 3–32 znaků: malá písmena, číslice, tečka, pomlčka nebo podtržítko.";
  }
  if (code === "PASSWORD_TOO_SHORT") return "Heslo musí mít alespoň 8 znaků.";
  if (code === "USERNAME_TAKEN") return "Toto uživatelské jméno už existuje.";
  if (code === "CANNOT_DELETE_SELF") return "Vlastní účet smazat nelze.";
  if (code === "CANNOT_DELETE_ADMIN") return "Účet správce smazat nelze.";
  if (code === "ACCOUNT_NOT_FOUND") return "Účet už neexistuje.";
  if (code === "NO_PASSWORD_ACCOUNT") return "Tento účet nemá heslo, nejde ho tak změnit.";
  if (code === "WRONG_PASSWORD") return "Současné heslo není správné.";
  return "Akce se nepovedla. Zkus to znovu.";
}

const inputClass =
  "w-full bg-secondary border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all disabled:opacity-50";

const deleteIcon = (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
    <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4z" />
  </svg>
);

const editIcon = (
  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
    <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293z" />
  </svg>
);

export function AccountsManager({ onClose }: { onClose: () => void }) {
  const accounts = useQuery(api.accounts.listAccounts);
  const createGuest = useAction(api.accounts.createGuest);
  const updateAccount = useAction(api.accounts.updateAccount);
  const deleteAccount = useAction(api.accounts.deleteAccount);
  const changeMyPassword = useAction(api.accounts.changeMyPassword);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Id<"users"> | null>(null);
  const [editing, setEditing] = useState<Id<"users"> | null>(null);

  const reset = () => {
    setError(null);
    setNotice(null);
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    reset();
    setBusy(true);
    try {
      await createGuest({ username, password });
      form.reset();
      setNotice(`Účet „${username.toLowerCase()}“ je vytvořený.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (event: React.FormEvent<HTMLFormElement>, id: Id<"users">) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    reset();
    setBusy(true);
    try {
      await updateAccount({
        userId: id,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      });
      setEditing(null);
      setNotice("Změny jsou uložené.");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: Id<"users">, username: string) => {
    if (!window.confirm(`Smazat účet „${username}“? Uživatel se přestane moci přihlásit.`)) {
      return;
    }
    reset();
    setDeleting(id);
    try {
      await deleteAccount({ userId: id });
      setNotice(`Účet „${username}“ byl smazán.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setDeleting(null);
    }
  };

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    reset();
    setBusy(true);
    try {
      await changeMyPassword({ currentPassword, newPassword });
      form.reset();
      setNotice("Heslo je změněné.");
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        data-testid="accounts-panel"
        className="w-full max-w-lg bg-card border border-border rounded-2xl p-6 shadow-2xl shadow-black/50 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="font-cormorant text-2xl font-medium text-foreground">Účty</h2>
            <p className="text-muted-foreground text-xs mt-1">
              Hosté se přihlašují uživatelským jménem a heslem.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            title="Zavřít"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
            </svg>
          </button>
        </div>

        <div className="mb-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            Existující účty
          </p>
          {accounts === undefined ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : (
            <ul className="space-y-1.5">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  data-testid="account-row"
                  data-username={account.username ?? ""}
                  className="bg-secondary/40 border border-border rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-foreground flex-1 truncate">
                      {account.username}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        account.isAdmin
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {account.isAdmin ? "Admin" : "Host"}
                    </span>
                    <button
                      onClick={() => {
                        reset();
                        setEditing(editing === account.id ? null : account.id);
                      }}
                      data-testid="account-edit"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-all"
                      title="Upravit účet"
                    >
                      {editIcon}
                    </button>
                    {!account.isAdmin && (
                      <button
                        onClick={() => void handleDelete(account.id, account.username ?? "")}
                        disabled={deleting === account.id}
                        data-testid="account-delete"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-50"
                        title="Smazat účet"
                      >
                        {deleting === account.id ? (
                          <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          deleteIcon
                        )}
                      </button>
                    )}
                  </div>

                  {editing === account.id && (
                    <form
                      onSubmit={(event) => void handleUpdate(event, account.id)}
                      data-testid="account-edit-form"
                      className="mt-3 space-y-2 border-t border-border/60 pt-3"
                    >
                      <input
                        name="username"
                        type="text"
                        defaultValue={account.username ?? ""}
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="nové uživatelské jméno"
                        className={inputClass}
                        disabled={busy}
                      />
                      <input
                        name="password"
                        type="password"
                        placeholder="nové heslo (nech prázdné pro zachování)"
                        className={inputClass}
                        disabled={busy}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={busy}
                          data-testid="account-save"
                          className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-xs font-medium hover:brightness-110 transition-all disabled:opacity-50"
                        >
                          {busy ? "Ukládám…" : "Uložit změny"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Zrušit
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={handleCreate} className="border-t border-border pt-5 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Nový host</p>
          <input
            name="username"
            type="text"
            required
            autoCapitalize="none"
            spellCheck={false}
            placeholder="uživatelské jméno"
            data-testid="new-username"
            disabled={busy}
            className={inputClass}
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="heslo (min. 8 znaků)"
            data-testid="new-password"
            disabled={busy}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy}
            data-testid="create-account"
            className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Vytvářím…" : "Vytvořit účet"}
          </button>
        </form>

        <form onSubmit={handleChangePassword} className="border-t border-border mt-5 pt-5 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Změna mého hesla
          </p>
          <input
            name="currentPassword"
            type="password"
            required
            placeholder="současné heslo"
            data-testid="current-password"
            disabled={busy}
            className={inputClass}
          />
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            placeholder="nové heslo (min. 8 znaků)"
            data-testid="new-own-password"
            disabled={busy}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy}
            data-testid="change-password"
            className="w-full bg-secondary border border-border text-foreground rounded-lg py-2.5 text-sm font-medium hover:border-primary/40 transition-all disabled:opacity-50"
          >
            {busy ? "Ukládám…" : "Změnit heslo"}
          </button>
          {notice && (
            <p data-testid="accounts-notice" className="text-xs text-emerald-400">
              {notice}
            </p>
          )}
          {error && (
            <p data-testid="accounts-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
