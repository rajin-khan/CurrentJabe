import Image from "next/image";

export function CurrentJabeMark({ className }: { className?: string }) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      height={384}
      sizes="36px"
      src="/brand/currentjabe-mark-v3.png"
      width={384}
    />
  );
}

export function CurrentJabeWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark" aria-label="CurrentJabe">
      <CurrentJabeMark className="wordmark__mark" />
      {compact ? null : (
        <span className="wordmark__type">
          Current<span>Jabe</span>
        </span>
      )}
    </span>
  );
}
