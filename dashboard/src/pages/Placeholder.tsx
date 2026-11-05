import { useLocation } from "react-router-dom";
import { NAV } from "../nav";
import { PageHeader } from "../components/ui";

/** Temporary page for modules built in later steps. */
export default function Placeholder() {
  const { pathname } = useLocation();
  const item = NAV.find((n) => n.to === pathname);
  return (
    <>
      <PageHeader title={item?.label ?? "Not found"} description={item ? `This module is implemented in step ${item.step}.` : "This page does not exist."} />
    </>
  );
}
