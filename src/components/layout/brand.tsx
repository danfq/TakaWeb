import app from "virtual:app"

/**
 * takaweb wordmark
 */
export default function Brand() {
  return (
    <div className="flex flex-row items-center gap-1">
      <h1 className="text-xl">
        Taka<span className="tracking-wide text-[#38afa5]">Web</span>
      </h1>

      <p className="text-muted-foreground text-xs">v{app.version}</p>
    </div>
  )
}
