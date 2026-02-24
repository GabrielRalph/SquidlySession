import { Features, OccupiableWindow } from "../../features-interface.js";
import { SvgPlus } from "../../../SvgPlus/4.js";
import { AccessEvent } from "../../../Utilities/Buttons/access-buttons.js";
import { relURL } from "../../../Utilities/usefull-funcs.js";
import { GridIcon } from "../../../Utilities/Buttons/grid-icon.js";


class SetUpWindow extends OccupiableWindow {
   constructor() {
       super("setup-window");


       this.root.events = {
           "setup-click": (e) => this.onSetupClick(e),
       };
   }


   async onSetupClick(e) {
       console.log(`Profile selected: ${e.profile || "unknown"}`);
       // Handle profile selection here
   }


   async open() {
       await this.show(400);
   }


   async close() {
       await this.hide(400);
       this.dispatchEvent(new Event("exit"));
   }


   static get usedStyleSheets() {
       return [relURL("./setup.css", import.meta)];
   }
}


export default class SetupFeature extends Features {
   /**
    * @param {import("../../features-interface.js").SquidlySession} session
    * @param {import("../../features-interface.js").SessionDataFrame} sdata
    */
   constructor(session, sdata) {
       super(session, sdata);


       // Store session reference for later use
       this._session = session;


       // Setup window
       this.setupWindow = new SetUpWindow();


       // Only add menu item and setup functionality for host
       if (this.sdata.me === "host") {
           this.session.toolBar.addMenuItem([], {
               name: "setup",
               index: 40,
               onSelect: (e) => {
                   try {
                       if (e.waitFor) {
                           e.waitFor(this.openWindow());
                       } else {
                           this.openWindow();
                       }
                   } catch (error) {
                       console.error("Error in onSelect:", error);
                   }
               }
           });


           this.setupWindow.root.addEventListener("setup-click", (e) => {
               console.log("Setup window clicked event received:", e);
           });


           this.setupWindow.events = {
               exit: () => {
                   this.dispatchEvent(new Event("exit"));
               }
           };
       }
   }


   async openWindow() {
       // Double-check host status before opening
       if (this.sdata.me !== "host") {
           console.warn("Setup window is only available to the host");
           return;
       }


       if (!this.setupWindow) {
           console.error("setupWindow is null/undefined!");
           return;
       }


       try {
           await this.setupWindow.open();
       } catch (error) {
           console.error("Error in setupWindow.open():", error);
       }


       try {
           this.showProfiles();
       } catch (error) {
           console.error("Error in showProfiles():", error);
       }
   }


   async closeWindow() {
       if (!this.setupWindow) return;
       await this.setupWindow.close();
   }


   async showProfiles() {
       let profiles;
       try {
           const Settings = await import("../../Settings/settings-wrapper.js");
           profiles = Settings.getProfiles();
           console.log("Retrieved profiles from database:", profiles);
          
           // Convert to the same format as before (name and icon only)
           profiles = profiles.map(profile => ({
               name: profile.name,
               icon: "👤" // Keep the same icon as before
           }));
       } catch (error) {
           console.warn("Could not load profiles from database, using defaults:", error);
           // Fallback to original default profiles if import fails
           profiles = [
               { name: "Alex", icon: "👤" },
               { name: "Jordan", icon: "👤" },
               { name: "Sam", icon: "👤" }
           ];
       }


       this.setupWindow.root.innerHTML = "";


       // Container
       const container = document.createElement("div");
       container.className = "setup-container";


       // Header
       const header = document.createElement("div");
       header.className = "setup-header";
      
       const title = document.createElement("h1");
       title.textContent = "Welcome!";
      
       const subtitle = document.createElement("p");
       subtitle.textContent = "Choose an existing profile or create a new one";
      
       header.appendChild(title);
       header.appendChild(subtitle);
       container.appendChild(header);


       // Existing Profiles Section
       const existingSection = document.createElement("div");
       existingSection.className = "existing-profiles-section";
      
       const existingTitle = document.createElement("h2");
       existingTitle.textContent = "EXISTING PROFILES";
       existingSection.appendChild(existingTitle);


       const profilesGrid = document.createElement("div");
       profilesGrid.className = "profiles-grid";


       profiles.forEach(profile => {
           const profileCard = document.createElement("button");
           profileCard.className = "profile-card";
          
           // Add inline styles to ensure it's clickable
           Object.assign(profileCard.style, {
               pointerEvents: 'auto',
               cursor: 'pointer',
               transition: 'all 0.3s'
           });
          
           const iconDiv = document.createElement("div");
           iconDiv.className = "profile-icon";
           iconDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
               <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
               <circle cx="12" cy="7" r="4"></circle>
           </svg>`;
           iconDiv.style.pointerEvents = 'none'; // Prevent icon from blocking clicks
          
           const nameDiv = document.createElement("div");
           nameDiv.className = "profile-name";
           nameDiv.textContent = profile.name;
           nameDiv.style.pointerEvents = 'none'; // Prevent text from blocking clicks
          
           profileCard.appendChild(iconDiv);
           profileCard.appendChild(nameDiv);
          
           // Click to select (not navigate)
           profileCard.onclick = () => {
               console.log("Profile selected:", profile.name);
              
               // Deselect all other profile cards
               profilesGrid.querySelectorAll('.profile-card').forEach(card => {
                   card.style.border = '';
                   card.style.boxShadow = '';
                   card.style.transform = '';
               });
              
               // Select this card
               profileCard.style.border = '4px solid #9b59b6';
               profileCard.style.boxShadow = '0 0 20px rgba(155, 89, 182, 0.5)';
               profileCard.style.transform = 'scale(1.05)';
              
               selectedProfile = profile.name;
              
               // Enable the continue button
               existingContinueBtn.disabled = false;
               Object.assign(existingContinueBtn.style, {
                   background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)',
                   cursor: 'pointer',
                   pointerEvents: 'auto',
                   opacity: '1'
               });
           };
          
           profilesGrid.appendChild(profileCard);
       });


       existingSection.appendChild(profilesGrid);
       container.appendChild(existingSection);


       // Create New Profile Section
       const newProfileSection = document.createElement("div");
       newProfileSection.className = "new-profile-section";
      
       const newProfileTitle = document.createElement("h2");
       newProfileTitle.textContent = "Create New Profile";
       newProfileSection.appendChild(newProfileTitle);


       const inputLabel = document.createElement("label");
       inputLabel.textContent = "Profile Name";
       inputLabel.className = "input-label";
       newProfileSection.appendChild(inputLabel);


       const input = document.createElement("input");
       input.type = "text";
       input.className = "profile-input";
       input.placeholder = "Enter your name";
      
       // Add inline styles to ensure input is editable
       Object.assign(input.style, {
           pointerEvents: 'auto',
           userSelect: 'text',
           WebkitUserSelect: 'text',
           MozUserSelect: 'text',
           msUserSelect: 'text'
       });
      
       newProfileSection.appendChild(input);


       const continueBtn = document.createElement("button");
       continueBtn.className = "continue-btn";
       continueBtn.textContent = "Continue";
      
       // Add inline styles to ensure button is visible and clickable
       Object.assign(continueBtn.style, {
           display: 'block',
           margin: '0 auto',
           padding: '15px 60px',
           fontSize: '18px',
           fontWeight: '600',
           background: 'linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)',
           color: 'white',
           border: 'none',
           borderRadius: '8px',
           cursor: 'pointer',
           transition: 'transform 0.2s, box-shadow 0.2s',
           pointerEvents: 'auto',
           zIndex: '10'
       });
      
       continueBtn.onclick = () => {
           const name = input.value.trim();
           if (!name) {
               alert("Please enter a profile name");
               return;
           }
           console.log("New profile - Continue clicked with name:", name);
           // Go to next page
           this.showNextPage(name);
       };
      
       // Add hover effect
       continueBtn.onmouseenter = () => {
           continueBtn.style.transform = 'translateY(-2px)';
           continueBtn.style.boxShadow = '0 5px 20px rgba(155, 89, 182, 0.4)';
       };
      
       continueBtn.onmouseleave = () => {
           continueBtn.style.transform = 'translateY(0)';
           continueBtn.style.boxShadow = 'none';
       };
      
       newProfileSection.appendChild(continueBtn);


       container.appendChild(newProfileSection);
       this.setupWindow.root.appendChild(container);
   }


showNextPage(profileName) {
   this.setupWindow.root.innerHTML = "";


   // Container
   const container = document.createElement("div");
   container.className = "setup-container";


   // Header
   const header = document.createElement("div");
   header.className = "setup-header";
  
   const title = document.createElement("h1");
   title.textContent = "Choose Your Access Method";
  
   header.appendChild(title);
   container.appendChild(header);


   // Access Methods Grid
   const accessGrid = document.createElement("div");
   accessGrid.className = "access-methods-grid";


   const accessMethods = [
       {
           name: "Eye Gaze",
           color: "#F4E07A",
           icon: `<svg viewBox="0 0 24 24" fill="currentColor">
               <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
           </svg>`,
           selected: false
       },
       {
           name: "Switch",
           color: "#C62828",
           icon: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4">
               <rect x="20" y="30" width="60" height="40" rx="8" fill="#4A4A4A"/>
               <circle cx="50" cy="50" r="18" fill="#B0B0B0"/>
               <circle cx="50" cy="50" r="12" fill="#808080"/>
           </svg>`,
           selected: false
       },
       {
           name: "Cursor",
           color: "#81D4FA",
           icon: `<svg viewBox="0 0 24 24" fill="currentColor">
               <path d="M13.64 21.97c-.21 0-.42-.07-.59-.21L7.83 17.5l-4.08 1.36c-.46.15-.95-.04-1.18-.45-.23-.41-.14-.93.22-1.25L21.32 2.44c.32-.29.78-.31 1.13-.05.35.26.47.7.3 1.09l-7.5 18.33c-.17.41-.56.68-1 .68-.01 0-.02 0-.03 0l.42-.52z"/>
           </svg>`,
           selected: false
       }
   ];


   // Continue button (created first so we can reference it)
   const continueBtn = document.createElement("button");
   continueBtn.className = "continue-btn-white";
   continueBtn.textContent = "Continue";
  
   Object.assign(continueBtn.style, {
       display: 'block',
       margin: '50px auto 0',
       padding: '18px 80px',
       fontSize: '24px',
       fontWeight: '700',
       background: '#666',
       color: '#333',
       border: 'none',
       borderRadius: '12px',
       cursor: 'not-allowed',
       transition: 'all 0.3s',
       pointerEvents: 'none',
       opacity: '0.5',
       zIndex: '10'
   });
  
   // Function to update continue button state
   const updateContinueButton = () => {
       const selectedCount = Array.from(accessGrid.querySelectorAll('[data-selected="true"]')).length;
      
       if (selectedCount > 0) {
           // Enable button
           Object.assign(continueBtn.style, {
               background: 'white',
               color: '#000',
               cursor: 'pointer',
               pointerEvents: 'auto',
               opacity: '1'
           });
       } else {
           // Disable button
           Object.assign(continueBtn.style, {
               background: '#666',
               color: '#333',
               cursor: 'not-allowed',
               pointerEvents: 'none',
               opacity: '0.5'
           });
       }
   };


   accessMethods.forEach((method, index) => {
       const methodCard = document.createElement("button");
       methodCard.className = "access-method-card";
       methodCard.setAttribute('data-selected', 'false');
      
       // Apply background color and ensure it's clickable
       Object.assign(methodCard.style, {
           background: method.color,
           pointerEvents: 'auto',
           cursor: 'pointer',
           zIndex: '5'
       });
      
       const iconDiv = document.createElement("div");
       iconDiv.className = "access-icon";
       iconDiv.innerHTML = method.icon;
       iconDiv.style.color = method.color === "#F4E07A" ? "#6B5B00" : (method.color === "#C62828" ? "#2A2A2A" : "#0277BD");
       iconDiv.style.pointerEvents = 'none'; // Prevent icon from blocking clicks
      
       const nameDiv = document.createElement("div");
       nameDiv.className = "access-name";
       nameDiv.textContent = method.name;
       nameDiv.style.color = method.color === "#F4E07A" ? "#6B5B00" : (method.color === "#C62828" ? "white" : "#0277BD");
       nameDiv.style.pointerEvents = 'none'; // Prevent text from blocking clicks
      
       methodCard.appendChild(iconDiv);
       methodCard.appendChild(nameDiv);
      
       methodCard.onclick = (e) => {
           e.stopPropagation();
           console.log(`Card clicked: ${method.name}`);
          
           // Toggle selection
           const isSelected = methodCard.getAttribute('data-selected') === 'true';
           methodCard.setAttribute('data-selected', (!isSelected).toString());
          
           if (!isSelected) {
               methodCard.style.border = '4px solid white';
               methodCard.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.5)';
           } else {
               methodCard.style.border = 'none';
               methodCard.style.boxShadow = 'none';
           }
          
           console.log(`${method.name} ${!isSelected ? 'selected' : 'deselected'}`);
          
           // Update continue button state
           updateContinueButton();
       };
      
       accessGrid.appendChild(methodCard);
   });


   container.appendChild(accessGrid);
  
   // Store reference to 'this' for use in onclick handler
   const self = this;
  


   continueBtn.onclick = async () => {
       const selectedMethods = Array.from(accessGrid.querySelectorAll('[data-selected="true"]'))
           .map(card => card.querySelector('.access-name').textContent);
      
       if (selectedMethods.length === 0) {
           return;
       }
      
       console.log(`Profile: ${profileName}, Selected methods:`, selectedMethods);
      
       if (selectedMethods.includes('Eye Gaze')) {
           console.log("Eye Gaze selected, starting walkthrough for all users...");
          
           await self.closeWindow();
          
           try {
               // Store the selected profile and methods in Firebase
               // Note: Only storing if we have permission, not critical for walkthrough
               try {
                   self.sdata.set("selectedProfile", {
                       name: profileName,
                       methods: selectedMethods
                   });
               } catch (permError) {
                   console.warn("Could not save profile to Firebase (permission issue):", permError);
                   // Continue anyway - this is not critical
               }
              
               // Trigger walkthrough start for all users via Firebase
               console.log("Triggering walkthrough via Firebase...");
               console.log("Session object:", self.session);
               console.log("Session._session:", self._session);
              
               // Use the stored session reference
               const session = self._session || self.session;
              
               if (!session) {
                   console.error("Session is undefined!");
                   return;
               }
              
               console.log("Features object:", session.features);
              
               const walkthroughFeature = session.getFeature("walkThrough");
              
              
               if (walkthroughFeature) {
                   console.log("Found walkthrough feature, starting calibration walkthrough...");
                   await walkthroughFeature.startCalibrationWalkthrough();
               } else {
                   console.error("Could not find walkthrough feature!");
                   console.log("Available features:", Array.from(session.features.keys()));
               }
           } catch (error) {
               console.error("Error triggering walkthrough:", error);
               console.error("Error stack:", error.stack);
           }
       } else {
           alert(`Profile: ${profileName}\nSelected: ${selectedMethods.join(', ')}\n\nWalkthrough coming soon for other access methods!`);
       }
   };


      
   continueBtn.onmouseenter = () => {
       if (continueBtn.style.pointerEvents === 'auto') {
           continueBtn.style.transform = 'translateY(-2px)';
           continueBtn.style.boxShadow = '0 5px 20px rgba(255, 255, 255, 0.3)';
       }
   };
  
   continueBtn.onmouseleave = () => {
       continueBtn.style.transform = 'translateY(0)';
       continueBtn.style.boxShadow = 'none';
   };
  
   container.appendChild(continueBtn);
   this.setupWindow.root.appendChild(container);
}


   async initialise() {
       // This method is called during feature initialization
   }


   static async loadResources() {
       // This is the key method that loads the stylesheets
       SetUpWindow.loadStyleSheets();
   }


   static get layers() {
       return {
           setupWindow: {
               type: "area",
               area: "fullAspectArea",
               index: 230,
               mode: "occupy",
           }
       };
   }


   static get name() {
       return "setup";
   }


   static get firebaseName() {
       return "setup";
   }
}
