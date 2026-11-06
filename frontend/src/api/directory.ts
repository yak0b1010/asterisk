import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BulkExtensionsInput, BulkExtensionsResult, DirectoryUser, Extension, ExtensionInput, UserInput } from "../types";
import { api } from "./client";

export const useUsers = () => useQuery({ queryKey: ["users"], queryFn: () => api<DirectoryUser[]>("/users") });
export const useExtensions = () =>
  useQuery({ queryKey: ["extensions"], queryFn: () => api<Extension[]>("/extensions"), refetchInterval: 10_000 });

/** Mutation that refreshes the given query keys on success. */
function useAction<TIn, TOut>(fn: (input: TIn) => Promise<TOut>, keys: string[][]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })) });
}

export const useSaveUser = () =>
  useAction(({ id, ...data }: UserInput & { id?: string }) =>
    id ? api<DirectoryUser>(`/users/${id}`, { method: "PUT", body: data }) : api<DirectoryUser>("/users", { method: "POST", body: data }),
    [["users"]]);

// Deleting a user unassigns their extensions, so both lists are refreshed.
export const useDeleteUser = () => useAction((id: string) => api<void>(`/users/${id}`, { method: "DELETE" }), [["users"], ["extensions"]]);

export const useSaveExtension = (isEdit: boolean) =>
  useAction((data: ExtensionInput) =>
    isEdit
      ? api<Extension>(`/extensions/${data.number}`, { method: "PUT", body: data })
      : api<Extension>("/extensions", { method: "POST", body: data }),
    [["extensions"]]);

export const useToggleExtension = () =>
  useAction(({ number, enabled }: { number: string; enabled: boolean }) =>
    api<Extension>(`/extensions/${number}`, { method: "PATCH", body: { enabled } }), [["extensions"]]);

export const useDeleteExtension = () => useAction((n: string) => api<void>(`/extensions/${n}`, { method: "DELETE" }), [["extensions"]]);

export const useBulkExtensions = () =>
  useAction((data: BulkExtensionsInput) => api<BulkExtensionsResult>("/extensions/bulk", { method: "POST", body: data }), [["extensions"]]);
