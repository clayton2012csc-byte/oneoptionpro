import { createFileRoute } from "@tanstack/react-router";
import { BackHeader } from "@/components/BackHeader";
import { DemoAccountPanel } from "@/components/DemoAccountPanel";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Conta Demo — OneOptiOnIA" },
      {
        name: "description",
        content:
          "Conta demo de R$ 100 com apostas simuladas de R$ 0,50 para medir o lucro ou prejuízo dos bilhetes.",
      },
      { property: "og:title", content: "Conta Demo — OneOptiOnIA" },
      {
        property: "og:description",
        content: "Teste os bilhetes do OneOptiOnIA sem risco e acompanhe o resultado real da estratégia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  return (
    <div className="pt-4">
      <BackHeader title="Conta Demo" />
      <DemoAccountPanel />
    </div>
  );
}
