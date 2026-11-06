import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/ui";
import ForwardingTab from "./ForwardingTab";
import NumberingTab from "./NumberingTab";
import RestrictionsTab from "./RestrictionsTab";
import TransferTab from "./TransferTab";

const TABS = [
  { id: "numbering", label: "Numbering plan", Component: NumberingTab },
  { id: "restrictions", label: "Call restrictions", Component: RestrictionsTab },
  { id: "forwarding", label: "Call forwarding", Component: ForwardingTab },
  { id: "transfer", label: "Transfer", Component: TransferTab },
] as const;

export default function Dialplan() {
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.id === params.get("tab")) ?? TABS[0];

  return (
    <>
      <PageHeader title="Dialplan" description="Changes are applied to Asterisk as soon as you save." />
      <div role="tablist" aria-label="Dialplan sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={t.id === active.id} onClick={() => setParams({ tab: t.id })}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${t.id === active.id ? "border-signal text-ink" : "border-transparent text-ink/60 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel"><active.Component /></div>
    </>
  );
}
