const container = document.getElementById("container");

function createFallingObject() {
  const fallingObject = document.createElement("div");
  fallingObject.classList.add("falling-object");
  container.appendChild(fallingObject);
 
  fallingObject.style.top = "-50px";
  fallingObject.style.left = `${Math.random() * 100}%`;
 
  function animateFallingObject() {
    const top = parseInt(fallingObject.style.top);
 
    if (top > container.clientHeight) {
      fallingObject.style.top = "-50px";
    } else {
      fallingObject.style.top = `${top + 1}px`;
    }
 
    requestAnimationFrame(animateFallingObject);
  }
 
  animateFallingObject();
}
 
for (let i = 0; i < 5; i++) {
  createFallingObject();
}