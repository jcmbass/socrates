import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import { deleteAccountThenLogout } from "../deleteAccount";

describe("deleteAccountThenLogout", () => {
  it("calls onDeleted and logout only after DELETE succeeds, onDeleted first", async () => {
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const logout = vi.fn().mockResolvedValue(undefined);
    const result = await deleteAccountThenLogout(deleteAccount, "tok", onDeleted, logout);
    expect(result).toEqual({ ok: true });
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(deleteAccount).toHaveBeenCalledWith("tok");
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
    // The reassurance screen's state must commit BEFORE logout: logout nulls
    // auth and /courses redirects to /login, which would unmount the screen.
    const onDeletedOrder = onDeleted.mock.invocationCallOrder[0];
    const logoutOrder = logout.mock.invocationCallOrder[0];
    expect(onDeletedOrder).toBeLessThan(logoutOrder);
  });

  it("calls neither onDeleted nor logout when the server fails", async () => {
    const err = new ApiError("internal_error", "boom", 500);
    const deleteAccount = vi.fn().mockRejectedValue(err);
    const onDeleted = vi.fn();
    const logout = vi.fn();
    const result = await deleteAccountThenLogout(deleteAccount, "tok", onDeleted, logout);
    expect(result).toEqual({ ok: false, error: err });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it("calls neither onDeleted nor logout on network_error", async () => {
    const err = new ApiError("network_error", "offline", null);
    const deleteAccount = vi.fn().mockRejectedValue(err);
    const onDeleted = vi.fn();
    const logout = vi.fn();
    const result = await deleteAccountThenLogout(deleteAccount, "tok", onDeleted, logout);
    expect(result.ok).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});