interface Props {
  color: "white" | "black";
}

export function ColorDot({ color }: Props) {
  const swatch =
    color === "white"
      ? "border-foreground/40 bg-background"
      : "border-foreground/40 bg-foreground";
  return (
    <span
      aria-hidden
      className={`inline-block size-2.5 shrink-0 rounded-full border ${swatch}`}
    />
  );
}
