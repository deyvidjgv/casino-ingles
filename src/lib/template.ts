/** Fills "{student1} & {student2}, talk about {topic}!" style phrases. Unknown keys stay as written. */
export function fillTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}
