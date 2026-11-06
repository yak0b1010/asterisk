import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DialRange, DialRangeInput, ForwardRule, ForwardRuleInput, QueueRef, Restrictions, ServiceNumber, ServiceNumberInput, TransferSettings,
} from "../types";
import { api } from "./client";

/** list + create/update + delete hooks for a REST collection */
function collection<T extends { id: string }, I>(base: string, key: string, extraKeys: string[] = []) {
  const useRefresh = () => {
    const qc = useQueryClient();
    return () => [key, ...extraKeys].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  return {
    useList: () => useQuery({ queryKey: [key], queryFn: () => api<T[]>(base) }),
    useSave: () => {
      const refresh = useRefresh();
      return useMutation({
        mutationFn: ({ id, ...data }: I & { id?: string }) =>
          id ? api<T>(`${base}/${id}`, { method: "PUT", body: data }) : api<T>(base, { method: "POST", body: data }),
        onSuccess: refresh,
      });
    },
    useDelete: () => {
      const refresh = useRefresh();
      return useMutation({ mutationFn: (id: string) => api<void>(`${base}/${id}`, { method: "DELETE" }), onSuccess: refresh });
    },
  };
}

// Deleting a range also drops its restriction rules, so restrictions are refreshed too.
export const ranges = collection<DialRange, DialRangeInput>("/dialplan/ranges", "dp-ranges", ["dp-restrictions"]);
export const services = collection<ServiceNumber, ServiceNumberInput>("/dialplan/service-numbers", "dp-services");
export const forwarding = collection<ForwardRule, ForwardRuleInput>("/dialplan/forwarding", "dp-forwarding");

export const useQueueRefs = () => useQuery({ queryKey: ["queues"], queryFn: () => api<QueueRef[]>("/queues") });

export const useRestrictions = () => useQuery({ queryKey: ["dp-restrictions"], queryFn: () => api<Restrictions>("/dialplan/restrictions") });
export const useSaveRestrictions = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Restrictions) => api<Restrictions>("/dialplan/restrictions", { method: "PUT", body: data }),
    onSuccess: (data) => qc.setQueryData(["dp-restrictions"], data),
  });
};

export const useTransfer = () => useQuery({ queryKey: ["dp-transfer"], queryFn: () => api<TransferSettings>("/dialplan/transfer") });
export const useSaveTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TransferSettings) => api<TransferSettings>("/dialplan/transfer", { method: "PUT", body: data }),
    onSuccess: (data) => qc.setQueryData(["dp-transfer"], data),
  });
};
