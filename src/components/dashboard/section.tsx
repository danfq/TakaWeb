import type { ReactNode } from "react"
import { cn } from "cn"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Tab = { value: string; label: string; content: ReactNode }

type SectionProps = {
  title: string
  description?: ReactNode
  className?: string
}

/**
 * section heading, shared by plain and tabbed sections
 */
function SectionHeader({ title, description, children }: SectionProps & { children?: ReactNode }) {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 px-5 pt-3 pb-2">
      <div className="min-w-0">
        {/* the mobile section picker already names it */}
        <h2 className="text-sm font-medium max-lg:sr-only">{title}</h2>
        {description && <p className="text-muted-foreground truncate text-xs">{description}</p>}
      </div>

      {children}
    </header>
  )
}

/**
 * scrollable body of a section, the only place content scrolls
 */
export function SectionBody({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("min-h-0 flex-1 scrollbar-thin overflow-y-auto px-5 pb-5", className)}>{children}</div>
  )
}

/**
 * a titled region of the dashboard
 */
export function Section({
  title,
  description,
  className,
  action,
  children,
}: SectionProps & { action?: ReactNode; children: ReactNode }) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <SectionHeader title={title} description={description}>
        {action}
      </SectionHeader>
      {children}
    </section>
  )
}

/**
 * a section whose extra data sits behind tabs
 */
export function TabbedSection({
  title,
  description,
  className,
  tabs,
  value,
  onValueChange,
}: SectionProps & {
  tabs: Tab[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      className={cn("flex min-h-0 min-w-0 flex-col gap-0", className)}
      render={<section />}>
      <SectionHeader title={title} description={description}>
        {tabs.length > 1 && (
          <TabsList className="h-8! shrink-0">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-2.5 text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
      </SectionHeader>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="flex min-h-0 flex-1 flex-col">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
