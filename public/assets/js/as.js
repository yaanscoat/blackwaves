document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('appSearchInput');
  const grid = document.querySelector('.apps-grid');
  let appsData = [];

  fetch('/assets/data/as.json')
    .then(response => response.json())
    .then(data => {
      appsData = data.apps; 

      displayApps(appsData); 

      searchInput.addEventListener('input', function() {
        const query = searchInput.value.toLowerCase();
        const filteredApps = appsData.filter(app => {
          const title = app.title ? app.title.toLowerCase() : '';
          const description = app.description ? app.description.toLowerCase() : '';
          return title.includes(query) || description.includes(query);
        });
        displayApps(filteredApps); 
      });
    })
    .catch(err => console.error('Error loading apps data:', err));

  function displayApps(apps) {
    grid.innerHTML = '';
    if (apps.length === 0) {
      grid.innerHTML = '<p>No apps found matching your search.</p>'; 
    }
    apps.forEach(app => {
      const card = document.createElement('div');
      card.classList.add('app-card');
      card.innerHTML = `
        <img src="${app.icon}" alt="${app.title} Icon" />
        <h2>${app.title}</h2>
      `;
      card.addEventListener('click', function() {
        window.handleSearch(app.link); 
      });
      grid.appendChild(card);
    });
  }
});
