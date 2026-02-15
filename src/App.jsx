import React, { useState, useEffect, useMemo } from 'react';
import './App.css';

// Helper to parse filename
// Rules: Character.svg, Character-N.svg (duplicate/variant). 
// If unicode (uniXXXX, uXXXX), convert to character.
function parseSvgName(filename) {
  const nameWithoutExt = filename.replace(/\.svg$/i, '');
  // Check for variant suffix "-N" where N is digits
  const match = nameWithoutExt.match(/^(.*)-(\d+)$/);
  
  let base = nameWithoutExt;
  let variantId = 0;
  
  if (match) {
    base = match[1];
    variantId = parseInt(match[2], 10);
  }
  
  // Unicode conversion
  let char = base;
  // Regex for "uniXXXX", "uXXXX", "U+XXXX" (4-5 hex chars)
  // Supports formats like U+1234.svg, uni1234.svg, u1234.svg
  const hexMatch = base.match(/^(?:uni|u\+|u)?([0-9A-Fa-f]{4,5})$/i);
  if (hexMatch) {
    try {
      const code = parseInt(hexMatch[1], 16);
      if (!isNaN(code)) {
        char = String.fromCodePoint(code);
      }
    } catch (e) {
      console.warn('Failed to parse unicode:', base);
    }
  }

  return { char, variantId };
}

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [svgList, setSvgList] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load initial settings
    window.appApi.getSettings().then(settings => {
      if (settings.lastUsed) {
        setRepoUrl(settings.lastUsed.repoUrl);
        setLocalPath(settings.lastUsed.destinationFolder);
      }
    });

    // Listen for status updates
    const unsubscribe = window.appApi.onStatusUpdate((msg) => {
      setStatus(msg);
    });
    return () => unsubscribe();
  }, []);

  const handleBrowse = async () => {
    const path = await window.appApi.pickFolder();
    if (path) setLocalPath(path);
  };

  const scanSvgs = async (path) => {
    setLoading(true);
    setStatus('Scanning for SVGs...');
    try {
      const svgs = await window.appApi.scanSvgs(path);
      setSvgList(svgs);
      setStatus(`Found ${svgs.length} SVGs`);
    } catch (err) {
      setStatus('Error scanning: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCloneOrUpdate = async () => {
    if (!repoUrl || !localPath) {
      setStatus('Please provide URL and Folder');
      return;
    }
    setLoading(true);
    try {
      const result = await window.appApi.gitOperation({ repoUrl, localPath });
      setStatus(result.message);
      if (result.success) {
        await scanSvgs(localPath);
      }
    } catch (err) {
      setStatus('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const groupedSvgs = useMemo(() => {
    const groups = {};
    svgList.forEach(svg => {
      const { char, variantId } = parseSvgName(svg.name);
      if (!groups[char]) groups[char] = [];
      groups[char].push({ ...svg, variantId });
    });
    
    // Sort variants within each group
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => a.variantId - b.variantId);
    });

    // Return as array of { char, items }
    return Object.entries(groups).map(([char, items]) => ({ char, items }));
  }, [svgList]);

  return (
    <div className="container">
      <header>
        <h1>InkTrace Viewer</h1>
      </header>
      
      <div className="controls">
        <div className="input-group">
          <label>Git Repo URL:</label>
          <input 
            value={repoUrl} 
            onChange={(e) => setRepoUrl(e.target.value)} 
            placeholder="https://github.com/..." 
          />
        </div>
        
        <div className="input-group">
          <label>Local Folder:</label>
          <div style={{display: 'flex', gap: '8px'}}>
            <input 
              value={localPath} 
              onChange={(e) => setLocalPath(e.target.value)} 
              placeholder="/path/to/folder" 
            />
            <button onClick={handleBrowse}>Browse</button>
          </div>
        </div>

        <div className="actions scan-controls">
          <button onClick={handleCloneOrUpdate} disabled={loading}>
            Clone / Update & Scan
          </button>
          <button onClick={() => scanSvgs(localPath)} disabled={loading || !localPath}>
            Scan Folder Only
          </button>
        </div>

        {status && <div className="status-bar">{status}</div>}
      </div>

      <div className="char-groups">
        {groupedSvgs.map((group) => (
          <div key={group.char} className="char-group">
            <div className="char-header">
              {group.char} <span style={{fontSize: '1rem', color:'#aaa'}}>({group.items.length} variants)</span>
            </div>
            <div className="char-content">
              {group.items.map((svg, index) => (
                <div 
                  key={index} 
                  className={`variant-card ${svg.variantId === 0 ? 'main-variant' : ''}`} 
                  title={svg.relativePath}
                >
                  <img src={`file://${svg.path}`} alt={svg.name} loading="lazy" />
                  <div className="variant-label">
                    {svg.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
