import { createFileRoute } from "@tanstack/react-router";
import { BackHeader } from "@/components/BackHeader";
import { TriagemPanel } from "@/components/TriagemPanel";

export const Route = createFileRoute("/triagem")({
  head: () => ({
    meta: [
      { title: "Triagem de elite por mercado — OneOptiOnIA" },
      {
        name: "description",
        content:
          "Jogos filtrados mercado a mercado com nota de confiança e assertividade própria de cada filtro.",
      },
      { property: "og:title", content: "Triagem de elite por mercado — OneOptiOnIA" },
      {
        property: "og:description",
        content:
          "Cada mercado tem seu próprio funil, sua própria conferência e sua própria taxa de acerto.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TriagemPage,
});

function TriagemPage() {
  return (
    <div className="pt-4">
      <BackHeader title="Triagem" />
      <TriagemPanel />
    </div>
  );
}
