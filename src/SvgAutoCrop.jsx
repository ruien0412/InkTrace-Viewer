import React, { useState, useEffect, useRef } from 'react';

/**
 * SvgAutoCrop Component
 * 
 * This component renders an SVG string or file, automatically calculating its optimal viewBox
 * to remove extraneous whitespace around the content.
 * 
 * Props:
 * - url (string): URL to fetch the SVG from.
 * - svgString (string): Raw SVG string content.
 * - className (string): Class for the wrapper div.
 * - style (object): Style for the wrapper div.
 */
const SvgAutoCrop = ({ url, svgString: initialSvgString, viewBox: initialViewBox, className, style, ...props }) => {
  const [svgContent, setSvgContent] = useState(initialSvgString || '');
  const [viewBox, setViewBox] = useState(initialViewBox || null);
  const hiddenContainerRef = useRef(null);

  // 1. Fetch SVG if URL is provided (ONLY if we don't have content AND don't have a viewBox provided)
  // Actually, even if we have viewBox, we need content to render it inline.
  // Unless we use <use>? But let's stick to inline for now as it's most robust for cropping.
  useEffect(() => {
    if (url && !initialSvgString) {
      // If we already have a viewBox from props, we still need content to render.
      // But maybe we can skip the "measure" step.
      fetch(url)
        .then((res) => res.text())
        .then((text) => setSvgContent(text))
        .catch((err) => console.error('Error loading SVG:', err));
    } else if (initialSvgString) {
      setSvgContent(initialSvgString);
    }
  }, [url, initialSvgString]);

  // Update internal viewBox if prop changes
  useEffect(() => {
    if (initialViewBox) setViewBox(initialViewBox);
  }, [initialViewBox]);

  // 2. Measure SVG Content Bounding Box (ONLY if viewBox not provided)
  useEffect(() => {
    // skip if we already have a viewBox
    if (viewBox || !svgContent || !hiddenContainerRef.current) return;

    const container = hiddenContainerRef.current;
    
    // Safety check: clear previous content
    container.innerHTML = '';

    // Create a temporary div to parse the string
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = svgContent;
    const svgElement = tempDiv.querySelector('svg');

    if (!svgElement) {
        console.warn('SvgAutoCrop: No SVG element found in content');
        return; 
    }

    // Append to hidden container (must be in DOM for getBBox to work)
    container.appendChild(svgElement);

    try {
      // getBBox() on the <svg> element returns the bounding box of its *renderable content*
      // (paths, shapes, groups) in user coordinate system.
      // It does NOT include the SVG's own viewport or padding.
      const bbox = svgElement.getBBox();
      
      if (bbox) {
         // Create new viewBox: "min-x min-y width height"
         // Using Math.floor/ceil to ensure we don't clip sub-pixel rendering edges
         const padding = 2; // Optional: add small padding
         const x = Math.floor(bbox.x - padding);
         const y = Math.floor(bbox.y - padding);
         const w = Math.ceil(bbox.width + padding * 2);
         const h = Math.ceil(bbox.height + padding * 2);
         
         const newViewBox = `${x} ${y} ${w} ${h}`;
         setViewBox(newViewBox);
      }
    } catch (error) {
       console.error('Error calculating SVG bbox:', error);
       // If measurement fails (e.g. no renderable content), 
       // keep original or let it be.
    }
    
    return () => {
      if (hiddenContainerRef.current) {
        hiddenContainerRef.current.innerHTML = '';
      }
    };
  }, [svgContent]);

  // 3. Render Final SVG with optimized ViewBox
  const renderOptimizedSvg = () => {
      if (!svgContent) return null;

      // Parse string to modify attributes
      // (In production, consider useMemo for this part if svgContent is large/stable)
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgContent, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');

      if (!svgEl) return null;

      // Apply calculated viewBox
      if (viewBox) {
          svgEl.setAttribute('viewBox', viewBox);
      }

      // Important: Remove width/height to allow CSS scaling
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      
      // Ensure it fills the container
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      svgEl.style.display = 'block'; // Remove inline spacing

      return (
          <div 
            dangerouslySetInnerHTML={{ __html: svgEl.outerHTML }} 
            style={{ width: '100%', height: '100%' }}
          />
      );
  };

  return (
    <div 
        className={`svg-auto-crop-wrapper ${className || ''}`} 
        style={{ ...style, position: 'relative', overflow: 'hidden' }}
        {...props}
    >
      {/* 
        Hidden Measurement Container 
        Using position/visibility ensures it's rendered but not seen.
        display: none would cause getBBox() to return all zeros.
      */}
      <div 
        ref={hiddenContainerRef} 
        style={{ 
          position: 'absolute', 
          width: 0, 
          height: 0, 
          overflow: 'hidden', 
          visibility: 'hidden',
          zIndex: -1,
          pointerEvents: 'none'
        }} 
        aria-hidden="true"
      />

      {/* Visible Content */}
      {renderOptimizedSvg()}
    </div>
  );
};

export default SvgAutoCrop;
