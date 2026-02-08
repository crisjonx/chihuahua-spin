document.addEventListener("DOMContentLoaded", function() {
    let spinCounter = -1;
    const spinInterval = 4200;
    function updateSpinCount() {
        spinCounter++;
        const spinText = (spinCounter === 1) ? 'spin' : 'spins';
        document.getElementById('spinCount').textContent = spinCounter;
        document.getElementById('spinText').textContent = spinText;
    }

    updateSpinCount(); // init counter
    setInterval(updateSpinCount, spinInterval);
});
