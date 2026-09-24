import { Target, TrendingUp, AlertCircle, Scan, Trophy, LayoutDashboard, Zap, FlaskConical, Radio, Crown, ClipboardList, Star, Bot, Filter, Layers, Wallet, Flame } from "lucide-react";
import { setActiveSection, useActiveSection } from "@/lib/active-section";

/** Camadas da arquitetura OneOptionIA — ordem em que os dados fluem. */
export const SECTION_GROUPS = [
  "1 · Dashboard",
  "2 · Motor de Bilhetes",
  "3 · Triagem (Filtro de Elite)",
  "4 · Estratégias",
  "5 · Configurações & Suporte",
] as const;

export const SECTIONS: { id: string; label: string; icon: string; lucide: any; href?: string; group: (typeof SECTION_GROUPS)[number] }[] = [
  // 1. Dashboard / site principal
  { id: "dashboard-clayton", label: "Dashboard Clayton", icon: "💎", lucide: LayoutDashboard, group: "1 · Dashboard" },
  { id: "melhores", label: "Melhores Jogos de Hoje", icon: "🔥", lucide: Flame, group: "1 · Dashboard" },
  // 2. Motor de bilhetes altos
  { id: "auditoria", label: "Bilhetes Auto", icon: "🤖", lucide: Radio, group: "2 · Motor de Bilhetes" },
  // 3. Triagem
  { id: "triagem", label: "Triagem", icon: "🔎", lucide: Filter, href: "/triagem", group: "3 · Triagem (Filtro de Elite)" },
  // 4. Estratégias alimentadas pela Triagem
  { id: "multiplas", label: "Múltiplas Populares", icon: "🎫", lucide: Trophy, group: "4 · Estratégias" },
  { id: "beta", label: "Beta", icon: "🧪", lucide: FlaskConical, group: "4 · Estratégias" },
  { id: "alfha", label: "Alfha", icon: "⚡", lucide: Zap, group: "4 · Estratégias" },
  { id: "fechamentos", label: "Fechamento Betano 3/4", icon: "🧩", lucide: Layers, href: "/fechamentos", group: "4 · Estratégias" },
  { id: "bingao", label: "Bingão", icon: "🎯", lucide: Target, group: "4 · Estratégias" },
  { id: "loteca", label: "Lotéca IA", icon: "🎟️", lucide: ClipboardList, group: "4 · Estratégias" },
  { id: "artilheiros", label: "Artilheiros", icon: "👑", lucide: Crown, group: "4 · Estratégias" },
  { id: "especiais-betano", label: "Especiais Betano", icon: "⭐", lucide: Star, group: "4 · Estratégias" },
  { id: "radar", label: "Radar OneOption", icon: "📡", lucide: Zap, group: "4 · Estratégias" },
  // 5. Configurações & suporte
  { id: "demo", label: "Contas (Demo / Real)", icon: "⚙️", lucide: Wallet, href: "/demo", group: "5 · Configurações & Suporte" },
  { id: "diagnostico", label: "Assistente IA", icon: "🧠", lucide: Bot, group: "5 · Configurações & Suporte" },
];
