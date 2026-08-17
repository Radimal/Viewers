import React from 'react';

/**
 * Radimal icons, registered via addIcon in the default extension's init
 * (3.13's supported mechanism — Icons.ByName resolves registered names, so
 * no ui-next patch is needed). SVGs ported from the fork's Icons.tsx.
 */

type IconProps = React.SVGProps<SVGSVGElement>;

export const ToolMonitor = (props: IconProps) => (
  <svg
    width="24px"
    height="24px"
    viewBox="0 0 24 24"
    {...props}
  >
    <g
      id="ToolMonitor"
      stroke="none"
      strokeWidth="1"
      fill="none"
      fillRule="evenodd"
    >
      <rect
        x="0"
        y="0"
        width="24"
        height="24"
      ></rect>
      <path
        d="M4 4h16v12H4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></path>
      <path
        d="M2 20h20M12 16v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></path>
    </g>
  </svg>
);

export const CloseWindows = (props: IconProps) => (
  <svg
    width="24px"
    height="24px"
    viewBox="0 0 24 24"
    {...props}
  >
    <g
      id="CloseWindows"
      stroke="none"
      strokeWidth="1"
      fill="none"
      fillRule="evenodd"
    >
      <rect
        x="0"
        y="0"
        width="24"
        height="24"
      ></rect>
      <path
        d="M4 4h16v12H4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></path>
      <path
        d="M2 20h20M12 16v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></path>
      <line
        x1="8"
        y1="8"
        x2="16"
        y2="16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></line>
      <line
        x1="16"
        y1="8"
        x2="8"
        y2="16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></line>
    </g>
  </svg>
);

export const OpenSavedWindows = (props: IconProps) => (
  <svg
    width="24px"
    height="24px"
    viewBox="0 0 24 24"
    {...props}
  >
    <g
      id="OpenWindows"
      stroke="none"
      strokeWidth="1"
      fill="none"
      fillRule="evenodd"
    >
      <rect
        x="0"
        y="0"
        width="24"
        height="24"
      ></rect>
      <rect
        x="4"
        y="4"
        width="12"
        height="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></rect>
      <rect
        x="8"
        y="8"
        width="12"
        height="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></rect>
    </g>
  </svg>
);

/**
 * PDF sheet with the Radimal logo. Pure presentational — visibility is the
 * caller's concern (the fork embedded hasCase/isChecked gating in the icon;
 * that now lives with the case-status cache).
 */
export const RadimalPdf = (props: IconProps) => {
  const reactId = React.useId();
  const patternId = `radimal-pdf-pattern-${reactId}`;
  const imageId = `radimal-pdf-image-${reactId}`;

  return (
    <svg
      width="16"
      height="20"
      viewBox="0 0 17 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      {...props}
    >
      <path
        d="M2.5 0.5C1.4 0.5 0.5 1.4 0.5 2.5V18.5C0.5 19.6 1.4 20.5 2.5 20.5H14.5C15.6 20.5 16.5 19.6 16.5 18.5V6.5L10.5 0.5H2.5Z"
        fill="black"
        stroke="#B51078"
        strokeWidth="1.5"
      />
      <rect
        x="2.15333"
        y="6.80666"
        width="12"
        height="10"
        fill={`url(#${patternId})`}
      />
      <defs>
        <pattern
          id={patternId}
          patternContentUnits="objectBoundingBox"
          width="1"
          height="1"
        >
          <use
            xlinkHref={`#${imageId}`}
            transform="matrix(0.000905797 0 0 0.00108696 0.05 0)"
          />
        </pattern>
        <image
          id={imageId}
          width="1105"
          height="920"
          preserveAspectRatio="none"
          xlinkHref="/assets/logo.png"
        />
      </defs>
    </svg>
  );
};

export const radimalIcons = {
  ToolMonitor,
  CloseWindows,
  OpenSavedWindows,
  RadimalPdf,
  // kebab aliases used by menuOptions / menu items
  'tool-monitor': ToolMonitor,
  'close-windows': CloseWindows,
  'open-saved-windows': OpenSavedWindows,
};
