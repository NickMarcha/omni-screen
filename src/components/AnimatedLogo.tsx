import { useRef, useEffect } from 'react'

/**
 * Animated logo (eye opens when hovered=true, closes when hovered=false). Inlined SVG so we can control SMIL from React.
 * Closed state = default; open state = when the surrounding button is hovered (hover state passed from parent).
 */
export function AnimatedLogo({ className, hovered }: { className?: string; hovered: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    const list = hovered ? svgRef.current.querySelectorAll('[data-anim-open]') : svgRef.current.querySelectorAll('[data-anim-close]')
    list.forEach((el) => {
      (el as SVGAnimateElement | SVGAnimateTransformElement).beginElement?.()
    })
  }, [hovered])

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width="280"
      height="300"
      viewBox="0 0 280 300"
      className={className}
    >
      <defs>
        <linearGradient id="screenGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E6F2FF" />
          <stop offset="100%" stopColor="#EDE6FF" />
        </linearGradient>
        <mask id="eyeMask">
          <rect x="0" y="0" width="280" height="300" fill="#000" />
          <path fill="#fff" d="M 60 96 Q 140 140 220 96 Q 140 140 60 96 Z">
            <animate
              data-anim-open
              attributeName="d"
              dur="0.25s"
              fill="freeze"
              begin="indefinite"
              values="M 60 96 Q 140 140 220 96 Q 140 140 60 96 Z;M 60 86 Q 140 64 220 86 Q 140 140 60 126 Z"
              keyTimes="0;1"
            />
            <animate
              data-anim-close
              attributeName="d"
              dur="0.2s"
              fill="freeze"
              begin="indefinite"
              values="M 60 86 Q 140 64 220 86 Q 140 140 60 126 Z;M 60 96 Q 140 140 220 96 Q 140 140 60 96 Z"
              keyTimes="0;1"
            />
          </path>
        </mask>
      </defs>
      <rect x="28" y="24" width="224" height="164" rx="20" fill="url(#screenGradient)" />
      <rect
        x="28"
        y="24"
        width="224"
        height="164"
        rx="20"
        fill="none"
        stroke="#000"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="132" y="188" width="16" height="28" rx="4" fill="#000" />
      <line x1="108" y1="230" x2="172" y2="230" stroke="#000" strokeWidth="14" strokeLinecap="round" />
      {/* Lower lid */}
      <path fill="none" stroke="#000" strokeWidth="14" strokeLinecap="round" d="M 60 96 Q 140 140 220 96">
        <animate
          data-anim-open
          attributeName="d"
          dur="0.25s"
          fill="freeze"
          begin="indefinite"
          values="M 60 96 Q 140 140 220 96;M 60 126 Q 140 136 220 126"
          keyTimes="0;1"
        />
        <animate
          data-anim-close
          attributeName="d"
          dur="0.2s"
          fill="freeze"
          begin="indefinite"
          values="M 60 126 Q 140 136 220 126;M 60 96 Q 140 140 220 96"
          keyTimes="0;1"
        />
      </path>
      {/* Upper lid */}
      <path fill="none" stroke="#000" strokeWidth="14" strokeLinecap="round" d="M 60 96 Q 140 140 220 96">
        <animate
          data-anim-open
          attributeName="d"
          dur="0.25s"
          fill="freeze"
          begin="indefinite"
          values="M 60 96 Q 140 140 220 96;M 60 86 Q 140 64 220 86"
          keyTimes="0;1"
        />
        <animate
          data-anim-close
          attributeName="d"
          dur="0.2s"
          fill="freeze"
          begin="indefinite"
          values="M 60 86 Q 140 64 220 86;M 60 96 Q 140 140 220 96"
          keyTimes="0;1"
        />
      </path>
      {/* Bottom lashes */}
      <g opacity={1}>
        <animate
          data-anim-open
          attributeName="opacity"
          dur="0.25s"
          fill="freeze"
          begin="indefinite"
          values="1;0"
          keyTimes="0;1"
        />
        <animate
          data-anim-close
          attributeName="opacity"
          dur="0.2s"
          fill="freeze"
          begin="indefinite"
          values="0;1"
          keyTimes="0;1"
        />
        <g transform="translate(0 112)">
          <g>
            <animateTransform
              data-anim-open
              attributeName="transform"
              type="scale"
              dur="0.25s"
              fill="freeze"
              begin="indefinite"
              values="1 1;1 0.01"
              keyTimes="0;1"
            />
            <animateTransform
              data-anim-close
              attributeName="transform"
              type="scale"
              dur="0.2s"
              fill="freeze"
              begin="indefinite"
              values="1 0.01;1 1"
              keyTimes="0;1"
            />
            <g transform="translate(0 -112)" fill="#000">
              <polygon points="82,110 96,118 80,154" />
              <polygon points="110,114 124,120 110,158" />
              <polygon points="134,118 146,118 140,162" />
              <polygon points="156,120 172,114 170,158" />
              <polygon points="184,118 198,110 200,154" />
            </g>
          </g>
        </g>
      </g>
      {/* Top lashes */}
      <g fill="#000" opacity={0} transform="translate(0 192) scale(1 -1)">
        <animate
          data-anim-open
          attributeName="opacity"
          dur="0.25s"
          fill="freeze"
          begin="indefinite"
          values="0;1"
          keyTimes="0;1"
        />
        <animate
          data-anim-close
          attributeName="opacity"
          dur="0.2s"
          fill="freeze"
          begin="indefinite"
          values="1;0"
          keyTimes="0;1"
        />
        <polygon points="82,110 96,118 80,154" />
        <polygon points="110,114 124,120 110,158" />
        <polygon points="134,118 146,118 140,162" />
        <polygon points="156,120 172,114 170,158" />
        <polygon points="184,118 198,110 200,154" />
      </g>
      {/* Pupil */}
      <g mask="url(#eyeMask)">
        <circle cx="140" cy="106" r="18" fill="#000" opacity={0}>
          <animate
            data-anim-open
            attributeName="opacity"
            dur="0.25s"
            fill="freeze"
            begin="indefinite"
            values="0;1"
            keyTimes="0;1"
          />
          <animate
            data-anim-close
            attributeName="opacity"
            dur="0.2s"
            fill="freeze"
            begin="indefinite"
            values="1;0"
            keyTimes="0;1"
          />
        </circle>
        <circle cx="140" cy="106" r="8" fill="#000" opacity={0}>
          <animate
            data-anim-open
            attributeName="opacity"
            dur="0.25s"
            fill="freeze"
            begin="indefinite"
            values="0;1"
            keyTimes="0;1"
          />
          <animate
            data-anim-close
            attributeName="opacity"
            dur="0.2s"
            fill="freeze"
            begin="indefinite"
            values="1;0"
            keyTimes="0;1"
          />
        </circle>
      </g>
    </svg>
  )
}
