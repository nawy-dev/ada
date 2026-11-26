import type { ReactNode } from "react";

import { PageBackButton } from "@/components/page-back-button";

/**
 * Header shared by the secondary sections (archive, trash, settings): the back button sits on the
 * start edge level with the title, and the short description reads as its subtitle.
 */
export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="flex items-start gap-3">
      <PageBackButton />
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold leading-10 tracking-tight">{title}</h1>
        {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
    </header>
  );
}
