import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './App.css';
import SvgAutoCrop from './SvgAutoCrop';
import LazyCharCard from './LazyCharCard';

// --- Helper Functions ---

function parseSvgName(filename) {
  const nameWithoutExt = filename.replace(/\.svg$/i, '');
  const match = nameWithoutExt.match(/^(.*)-(\d+)$/);
  
  let base = nameWithoutExt;
  let variantId = 0;
  
  if (match) {
    base = match[1];
    variantId = parseInt(match[2], 10);
  }
  
  // Unicode conversion
  let char = base;
  const parseCodePointToken = (token) => {
    const tokenMatch = token.match(/^(?:uni|u\+|u)?([0-9A-Fa-f]{4,6})$/i);
    if (!tokenMatch) return null;
    const codePoint = parseInt(tokenMatch[1], 16);
    return Number.isNaN(codePoint) ? null : codePoint;
  };

  try {
    const parts = base.split('_').filter(Boolean);
    const parsedCodes = parts.map(parseCodePointToken);
    const allValid = parsedCodes.length > 0 && parsedCodes.every(code => code !== null);

    if (allValid) {
      char = String.fromCodePoint(...parsedCodes);
    }
  } catch (e) {
    console.warn('Failed to parse unicode:', base);
  }

  return { char, variantId, displayName: char };
}


// --- Icons ---
const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{position:'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5}}>
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const IconBack = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
);

const IconClose = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const IconFolder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
     <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
);

const IconChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
);

const IconChevronRight = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
);

// --- Components ---

const SettingsModal = ({ 
  isOpen, 
  onClose, 
  repoUrl, 
  setRepoUrl, 
  localPath, 
  setLocalPath, 
  onBrowse, 
  onClone, 
  onScan, 
  loading, 
  status 
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose}><IconClose /></button>
        </div>
        <div className="modal-content">
          <div className="form-group">
            <label>Git Repository URL</label>
            <input 
              value={repoUrl} 
              onChange={(e) => setRepoUrl(e.target.value)} 
              placeholder="https://github.com/user/repo" 
            />
          </div>
          <div className="form-group">
            <label>Local Folder Path</label>
            <div className="input-row">
              <input 
                style={{flex: 1}}
                value={localPath} 
                onChange={(e) => setLocalPath(e.target.value)} 
                placeholder="/path/to/local/folder" 
              />
              <button className="btn" onClick={onBrowse} title="Browse Folder">
                <IconFolder />
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClone} disabled={loading || !repoUrl || !localPath}>
            {loading ? 'Processing...' : 'Clone / Update'}
          </button>
          <button className="btn primary" onClick={onScan} disabled={loading || !localPath}>
            {loading ? 'Scanning...' : 'Scan Folder'}
          </button>
        </div>
        {loading && (
          <div className="loading-overlay">
            <div className="spinner"></div> {/* Could add CSS spinner */}
            <span>{status || 'Working...'}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const DetailView = ({ group, onClose, onPrev, onNext, hasPrev, hasNext }) => {
  const [selectedVariant, setSelectedVariant] = useState(group.items[0]);
  const [bgMode, setBgMode] = useState('checkerboard'); // 'checkerboard', 'white', 'black'
  const variantListRef = useRef(null);

  // Reset to main variant (id 0) or first available when switching groups
  useEffect(() => {
    const main = group.items.find(v => v.variantId === 0) || group.items[0];
    setSelectedVariant(main);
  }, [group]);

  // Auto-scroll to selected variant
  useEffect(() => {
    if (variantListRef.current && selectedVariant) {
      const selectedIndex = group.items.indexOf(selectedVariant);
      const selectedElement = variantListRef.current.children[selectedIndex];
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedVariant, group.items]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Left/Right: Switch between characters
      if (e.key === 'ArrowLeft' && hasPrev) {
        onPrev();
      }
      if (e.key === 'ArrowRight' && hasNext) {
        onNext();
      }
      
      // Up/Down: Switch between variants
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = group.items.indexOf(selectedVariant);
        if (currentIndex > 0) {
          setSelectedVariant(group.items[currentIndex - 1]);
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentIndex = group.items.indexOf(selectedVariant);
        if (currentIndex < group.items.length - 1) {
          setSelectedVariant(group.items[currentIndex + 1]);
        }
      }
      
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasPrev, hasNext, onPrev, onNext, onClose, group.items, selectedVariant]);

  return (
    <div className="detail-view">
      <div className="detail-toolbar">
         <button className="back-btn" onClick={onClose}>
           <IconBack /> Back
         </button>
         
         <div style={{flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16}}>
            <button 
              className="icon-btn" 
              onClick={onPrev} 
              disabled={!hasPrev} 
              title="Previous Character (← Left Arrow)"
              style={{opacity: hasPrev ? 1 : 0.3}}
            >
              <IconChevronLeft />
            </button>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{fontSize: '18px', margin: 0, minWidth: 60}}>{group.char}</h2>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                ←→ Characters
              </div>
            </div>
            <button 
              className="icon-btn" 
              onClick={onNext} 
              disabled={!hasNext} 
              title="Next Character (→ Right Arrow)"
              style={{opacity: hasNext ? 1 : 0.3}}
            >
              <IconChevronRight />
            </button>
         </div>

         {/* Placeholder to balance the layout */}
         <div style={{width: 60}}></div>
      </div>
      
      <div className="detail-content">
        <div className="variant-sidebar">
          <div className="variant-sidebar-header">
            Variants ({group.items.length})
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '400', marginTop: '4px' }}>
              ↑↓ Switch variants
            </div>
          </div>
          <div className="variant-list" ref={variantListRef}>
            {group.items.map((v, i) => (
              <div 
                key={i} 
                className={`variant-item ${selectedVariant === v ? 'active' : ''}`}
                onClick={() => setSelectedVariant(v)}
              >
                <div className="variant-thumb">
                   {/* Use SvgAutoCrop for consistent cropping even in thumbnails */}
                   <SvgAutoCrop 
                     url={`file://${v.path}`} 
                     viewBox={v.viewBox}
                     style={{ width: '100%', height: '100%' }}
                     className="thumb-svg"
                   />
                </div>
                <div className="variant-info">
                  <span className="variant-name">
                    {v.variantId === 0 ? 'Main Version' : `Variant ${v.variantId}`}
                  </span>
                  <span className="variant-meta">{v.relativePath}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className={`preview-area bg-${bgMode}`} key={group.char}>
          {selectedVariant && (
            <div key={selectedVariant.path} style={{ width: '100%', height: '100%', padding: 20 }}>
             <SvgAutoCrop 
               url={`file://${selectedVariant.path}`} 
               viewBox={selectedVariant.viewBox}
               style={{ width: '100%', height: '100%' }}
             />
             <div style={{ position: 'absolute', bottom: 10, left: 10, fontSize: 12, color: bgMode === 'white' ? '#888' : '#aaa' }}>
               Path: {selectedVariant.path}
             </div>
            </div>
          )}
          
          {/* Background Toggle */}
          <div className="bg-toggle-btn">
            <div 
              className={`bg-option checkerboard ${bgMode === 'checkerboard' ? 'active' : ''}`}
              onClick={() => setBgMode('checkerboard')}
              title="Checkerboard"
            />
            <div 
              className={`bg-option white ${bgMode === 'white' ? 'active' : ''}`}
              onClick={() => setBgMode('white')}
              title="White Background"
            />
            <div 
              className={`bg-option black ${bgMode === 'black' ? 'active' : ''}`}
              onClick={() => setBgMode('black')}
              title="Black Background"
            />
          </div>
        </div>
      </div>
    </div>
  );
};


function App() {
  // State
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [svgList, setSvgList] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [returnToChar, setReturnToChar] = useState('');
  const charCardRefs = useRef(new Map());
  const hasInitialized = useRef(false);

  // Initialize
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    let isMounted = true;

    (async () => {
      const settings = await window.appApi.getSettings();
      if (!isMounted) return;

      if (settings.lastUsed) {
        const savedRepoUrl = settings.lastUsed.repoUrl || '';
        const savedPath = settings.lastUsed.destinationFolder || '';

        setRepoUrl(savedRepoUrl);
        setLocalPath(savedPath);

        if (savedPath) {
          scanSvgs(savedPath);
        } else {
          setShowSettings(true);
        }
      } else {
        setShowSettings(true);
      }
    })();

    const unsubscribe = window.appApi.onStatusUpdate((msg) => {
      setStatus(msg);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    const timeout = setTimeout(() => setStatus(''), 2500);
    return () => clearTimeout(timeout);
  }, [status]);

  // Actions
  const handleBrowse = async () => {
    const path = await window.appApi.pickFolder();
    if (path) setLocalPath(path);
  };

  const scanSvgs = async (targetPath = localPath) => {
    if (!targetPath) return;
    setLoading(true);
    setStatus('Scanning SVG files...');
    try {
      const svgs = await window.appApi.scanSvgs(targetPath);
      setSvgList(svgs);
      const withViewBox = svgs.filter(s => s.viewBox).length;
      setStatus(`Found ${svgs.length} SVGs (${withViewBox} pre-calculated)`);
      setShowSettings(false); // Close modal on success
    } catch (err) {
      setStatus('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCloneOrUpdate = async () => {
    if (!repoUrl || !localPath) return;
    setLoading(true);
    try {
      const result = await window.appApi.gitOperation({ repoUrl, localPath });
      setStatus(result.message);
      if (result.success) {
        await scanSvgs();
      }
    } catch (err) {
      setStatus('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Data Processing
  const groupedData = useMemo(() => {
    const groups = {};
    svgList.forEach(svg => {
      let char, variantId;
      try {
         const parsed = parseSvgName(svg.name);
         char = parsed.char;
         variantId = parsed.variantId;
      } catch (e) {
         char = svg.name;
         variantId = 0;
      }
      
      if (!groups[char]) groups[char] = [];
      groups[char].push({ ...svg, variantId });
    });
    
    // Sort variants: Main (0) first, then by ID
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => a.variantId - b.variantId);
    });

    // Extract main SVG for preview
    return Object.entries(groups)
      .map(([char, items]) => ({ 
        char, 
        items,
        mainSvg: items.find(i => i.variantId === 0) || items[0]
      }))
      .sort((a, b) => a.char.localeCompare(b.char));
  }, [svgList]);

  const filteredData = useMemo(() => {
    if (!searchQuery) return groupedData;
    const lowerQ = searchQuery.toLowerCase();
    return groupedData.filter(g => 
      g.char.toLowerCase().includes(lowerQ) || 
      g.items.some(i => i.name.toLowerCase().includes(lowerQ))
    );
  }, [groupedData, searchQuery]);

  const setCharCardRef = useCallback((char, node) => {
    if (node) {
      charCardRefs.current.set(char, node);
    } else {
      charCardRefs.current.delete(char);
    }
  }, []);

  const handleCloseDetail = useCallback(() => {
    if (selectedGroup?.char) {
      setReturnToChar(selectedGroup.char);
    }
    setSelectedGroup(null);
  }, [selectedGroup]);

  useEffect(() => {
    if (selectedGroup || !returnToChar) return;

    requestAnimationFrame(() => {
      const cardNode = charCardRefs.current.get(returnToChar);
      if (cardNode) {
        cardNode.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      }
      setReturnToChar('');
    });
  }, [selectedGroup, returnToChar, filteredData]);

  return (
    <div className="app-container">
      {/* Toolbar - Only show when main grid is visible */}
      {!selectedGroup && (
        <div className="toolbar">
          <h1>InkTrace Viewer</h1>
          
          <div className="search-bar">
            <IconSearch />
            <input 
              type="text" 
              placeholder="Search characters (e.g. 'A', 'uni1234')..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{flex: 1}}></div>

          <button 
            className="icon-btn" 
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <IconSettings />
          </button>
        </div>
      )}

      {/* Main Grid - Only render when no detail view is open */}
      {!selectedGroup && (
        <div className="main-content">
          {filteredData.length === 0 ? (
            <div className="empty-state">
              <p>{svgList.length === 0 ? "No characters loaded." : "No matches found."}</p>
              {svgList.length === 0 && (
                <button onClick={() => setShowSettings(true)}>Configure Source</button>
              )}
            </div>
          ) : (
            <>
              {filteredData.length > 100 && (
                <div style={{ 
                  padding: '12px 0', 
                  textAlign: 'center', 
                  color: 'var(--text-secondary)', 
                  fontSize: '13px',
                  marginBottom: '10px'
                }}>
                  Showing {filteredData.length} character{filteredData.length !== 1 ? 's' : ''} 
                  {searchQuery && ` matching "${searchQuery}"`}
                </div>
              )}
              <div className="char-grid">
                {filteredData.map(group => (
                  <div key={group.char} ref={(node) => setCharCardRef(group.char, node)}>
                    <LazyCharCard
                      group={group}
                      onClick={() => setSelectedGroup(group)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Overlays */}
      <SettingsModal 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        repoUrl={repoUrl}
        setRepoUrl={setRepoUrl}
        localPath={localPath}
        setLocalPath={setLocalPath}
        onBrowse={handleBrowse}
        onClone={handleCloneOrUpdate}
        onScan={scanSvgs}
        loading={loading}
        status={status}
      />

      {selectedGroup && (() => {
        const index = filteredData.indexOf(selectedGroup);
        const hasPrev = index > 0;
        const hasNext = index < filteredData.length - 1;

        return (
          <DetailView 
            group={selectedGroup} 
            onClose={handleCloseDetail}
            hasPrev={hasPrev}
            hasNext={hasNext} 
            onPrev={() => hasPrev && setSelectedGroup(filteredData[index - 1])}
            onNext={() => hasNext && setSelectedGroup(filteredData[index + 1])}
          />
        );
      })()}

      {/* Status Toast */}
      {status && (
        <div className="toast-container">
           <div className="toast">{status}</div>
        </div>
      )}
    </div>
  );
}

export default App;
