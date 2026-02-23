import React, { useState, useEffect, useMemo } from 'react';

/**
 * SvgAutoCrop
 *
 * Renders an SVG with an externally-supplied viewBox (pre-computed by the main process
 * using global 5%/95% percentile statistics — same algorithm as the Python font builder).
 * Falls back to the SVG's own viewBox attribute when none is provided.
 *
 * Props:
 * - url       (string) : file:// URL to load the SVG from.
 * - svgString (string) : raw SVG markup (alternative to url).
 * - viewBox   (string) : pre-computed viewBox — always supplied by the scanner.
 * - className (string) : CSS class for the wrapper div.
 * - style     (object) : inline styles for the wrapper div.
 */
const SvgAutoCrop = ({ url, svgString: initialSvgString, viewBox, className, style, ...props }) => {
  const [svgContent, setSvgContent] = useState(initialSvgString || '');

  // Load SVG from URL when needed
  useEffect(() => {
    if (url && !initialSvgString) {
      fetch(url)
        .then(res => res.text())
        .then(text => setSvgContent(text))
        .catch(err => console.error('SvgAutoCrop: failed to load', url, err));
    } else if (initialSvgString) {
      setSvgContent(initialSvgString);
    }
  }, [url, initialSvgString]);

  // Inject the pre-computed viewBox and let CSS handle sizing
  const renderedSvg = useMemo(() => {
    if (!svgContent) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return null;

    if (viewBox) {
      svgEl.setAttribute('viewBox', viewBox);
    }
    // Let CSS / parent control size
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.width  = '100%';
    svgEl.style.height = '100%';
    svgEl.style.display = 'block';

    return (
      <div
        dangerouslySetInnerHTML={{ __html: svgEl.outerHTML }}
        style={{ width: '100%', height: '100%' }}
      />
    );
  }, [svgContent, viewBox]);

  return (
    <div
      className={`svg-auto-crop-wrapper ${className || ''}`}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
      {...props}
    >
      {renderedSvg}
    </div>
  );
};

export default React.memo(SvgAutoCrop, (prev, next) =>
  prev.url === next.url &&
  prev.viewBox === next.viewBox &&
  prev.svgString === next.svgString
);
