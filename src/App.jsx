import React, { useState, useEffect } from 'react';
import './App.css';

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

        <div className="actions">
          <button onClick={handleCloneOrUpdate} disabled={loading}>
            {loading ? 'Processing...' : 'Clone / Update & Scan'}
          </button>
        </div>

        {status && <div className="status-bar">{status}</div>}
      </div>

      <div className="grid-container">
        {svgList.map((svg, index) => (
          <div key={index} className="grid-item" title={svg.relativePath}>
            <div className="svg-preview">
                <img src={`file://${svg.path}`} alt={svg.name} loading="lazy" />
            </div>
            <div className="svg-name">{svg.name}</div>
             <div className="svg-path">{svg.relativePath}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
