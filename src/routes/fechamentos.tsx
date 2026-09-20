import { createFileRoute } from "@tanstack/react-router";
import { BackHeader } from "@/components/BackHeader";
import { FechamentoBetanoPanel } from "@/components/FechamentoBetanoPanel";

export const Route = createFileRoute("/fechamentos")({
  head: () => ({
    meta: [
      { title: "Fechamento Betano 3/4 — OneOptiOnIA" },
      {
        name: "description",
        content:
          "Os 4 melhores jogos do dia com 3 opções de cobertura cada, prontos para o Sistema 3/4 da Betano.",
      },
      { property: "og:title", content: "Fechamento Betano 3/4 — OneOptiOnIA" },
      {
        property: "og:description",
        content:
          "Odds altas com cobertura total: placar múltiplo, especiais e aposta montada de proteção em cada jogo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FechamentosPage,
});

function FechamentosPage() {
  return (
    <div className="pt-4">
      <BackHeader title="Fechamento Betano 3/4" />
      <FechamentoBetanoPanel />
    </div>
  );
}
