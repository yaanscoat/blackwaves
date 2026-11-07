document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('gameSearchInput');
  const grid = document.querySelector('.games-grid');
  let gamesData = [];

  fetch('/assets/data/gs.json')
    .then(response => response.json())
    .then(data => {
      gamesData = data.games; 

      displayGames(gamesData); 

      searchInput.addEventListener('input', function() {
        const query = searchInput.value.toLowerCase();
        const filteredGames = gamesData.filter(game => {
          const title = game.title ? game.title.toLowerCase() : '';
          const description = game.description ? game.description.toLowerCase() : '';
          return title.includes(query) || description.includes(query);
        });
        displayGames(filteredGames); 
      });
    })
    .catch(err => console.error('Error loading games data:', err));

  function displayGames(games) {
    grid.innerHTML = '';
    if (games.length === 0) {
      grid.innerHTML = '<p>No games found matching your search.</p>'; 
    }
    games.forEach(game => {
      const card = document.createElement('div');
      card.classList.add('game-card');
      card.innerHTML = `
        <img src="${game.icon}" alt="${game.title} Icon" loading="lazy" />
        <h2>${game.title}</h2>
      `;
      card.addEventListener('click', function() {
        window.handleSearch(game.link); 
      });
      grid.appendChild(card);
    });
  }
});
