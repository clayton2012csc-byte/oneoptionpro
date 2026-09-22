import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Abre a página completa do jogo a partir de qualquer lista do site.
 * Uso: <FixtureLink fixtureId={123}>Time A x Time B</FixtureLink>
 */
export function FixtureLink({
  fixtureId,
  children,
  className = "",
  title = "Abrir o jogo",
}: {
  fixtureId: number | string | null | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  if (fixtureId === null || fixtureId === undefined || fixtureId === "") {
    return <>{children}</>;
  }
  return (
    <Link
      to="/jogo/$fixtureId"
      params={{ fixtureId: String(fixtureId) }}
      title={title}
      onClick={(e) => e.stopPropagation()}
      className={`hover:text-primary hover:underline underline-offset-2 transition-colors ${className}`}
    >
      {children}
    </Link>
  );
}
