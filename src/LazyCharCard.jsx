import React, { useState, useEffect, useRef } from 'react';
import SvgAutoCrop from './SvgAutoCrop';

/**
 * LazyCharCard - A character card that only loads SVG when visible
 */
const LazyCharCard = ({ group, onClick }) => {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            // Once visible, stop observing (no need to unload)
            observer.unobserve(entry.target);
          }
        });
      },
      {
        root: null,
        rootMargin: '200px', // Load 200px before entering viewport
        threshold: 0.01
      }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      if (cardRef.current) {
        observer.unobserve(cardRef.current);
      }
    };
  }, []);

  return (
    <div 
      ref={cardRef}
      className="char-card"
      onClick={onClick}
    >
      {group.items.length > 1 && (
        <span className="variant-badge">+{group.items.length - 1}</span>
      )}
      <div className="char-preview">
        {isVisible ? (
          <SvgAutoCrop 
            url={`file://${group.mainSvg.path}`} 
            viewBox={group.mainSvg.viewBox}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          // Lightweight placeholder - just the character itself
          <div style={{ 
            width: '100%', 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#555',
            fontSize: '32px',
            fontWeight: '300',
            userSelect: 'none'
          }}>
            {group.char}
          </div>
        )}
      </div>
      <div className="char-name">{group.char}</div>
    </div>
  );
};

export default React.memo(LazyCharCard, (prevProps, nextProps) => {
  return prevProps.group.char === nextProps.group.char;
});
