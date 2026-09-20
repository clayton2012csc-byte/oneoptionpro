import { createFileRoute } from "@tanstack/react-router";
import { BackHeader } from "@/components/BackHeader";
import { FechamentoBetanoPanel } from "@/components/FechamentoBetanoPanel";

export const Route = createFileRoute("/fechamentos")({
  head: () => ({
    meta: [
      { title: "Fechamento Betano 3/4 + Especiais — OneOptiOnIA" },
      {
        name: "description",
        content:
          "Os 4 melhores jogos do dia com 3 opções de cobertura cada, blocos de estatísticas e mercados especiais da Betano. Sistema 3/4 com odds altas.",
      },
      { property: "og:title", content: "Fechamento Betano 3/4 + Especiais — OneOptiOnIA" },
      {
        property: "og:description",
        content:
          "Odds altas com cobertura total: placar múltiplo, especiais e aposta montada de proteção em cada jogo, mais estatísticas em tempo real.",
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
      <BackHeader title="Fechamento Betano 3/4 + Especiais" />
      <FechamentoBetanoPanel />
    </div>
  );
}
