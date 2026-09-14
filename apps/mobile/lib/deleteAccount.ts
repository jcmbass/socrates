/**
 * Account deletion (Play B16): call DELETE /v1/account, then local logout
 * ONLY on success. A network/server failure must leave the student signed in.
 *
 * `onDeleted` runs after the DELETE succeeds but BEFORE logout: logout nulls
 * the auth blob and /courses answers with <Redirect href="/login">, which
 * otherwise wins the race against the reassurance screen's setState and
 * unmounts it before it ever renders (QA tanda 0.3.0, b16-5b).
 */
export async function deleteAccountThenLogout(
  deleteAccount: (token: string) => Promise<void>,
  token: string,
  onDeleted: () => void,
  logout: () => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await deleteAccount(token);
  } catch (error) {
    return { ok: false, error };
  }
  onDeleted();
  await logout();
  return { ok: true };
}