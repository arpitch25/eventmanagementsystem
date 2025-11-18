// Access the Firebase config exposed by index.html
const firebaseConfig = window.firebaseConfig;

// Import Firebase functions using the modular pattern (must match the version in index.html)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, deleteDoc, runTransaction, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global state variables
let currentUser = null;
let events = [];
let tickets = [];
let idCards = [];
let pendingTicketData = null; 

// 1. AUTHENTICATION LISTENER
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        document.getElementById('userName').textContent = user.displayName || user.email; 
        showDashboard();
        setupFirestoreListeners();
    } else {
        currentUser = null;
        showLogin();
    }
});

function setupFirestoreListeners() {
    // 1. Events Listener (Ordered by date)
    onSnapshot(query(collection(db, 'events'), orderBy('date', 'asc')), snapshot => {
        events = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        updateAllUI();
    });

    // 2. Tickets Listener (Ordered by bookingTime for analysis)
    onSnapshot(query(collection(db, 'tickets'), orderBy('bookingTime', 'desc')), snapshot => {
        tickets = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        updateAllUI();
    });

    // 3. ID Cards Listener
    onSnapshot(query(collection(db, 'idcards'), orderBy('issuedDate', 'desc')), snapshot => {
        idCards = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        updateAllUI();
    });
}


// ==================== UI & AUTH FUNCTIONS ====================

function showLogin() {
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('registerPage').classList.add('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    // Show video background only on login/register pages
    document.querySelector('.video-background').classList.remove('hidden');
}

function showRegister() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('registerPage').classList.remove('hidden');
    // Show video background
    document.querySelector('.video-background').classList.remove('hidden');
}

function showDashboard() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('registerPage').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    // Hide video background when on the dashboard
    document.querySelector('.video-background').classList.add('hidden');
    // Set a solid background for the dashboard
    document.body.style.background = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
}

function logout() {
    signOut(auth);
    // Reset body background when logging out
    document.body.style.background = "#000";
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`).classList.add('active');
    document.getElementById(tab + 'Tab').classList.add('active');
    
    // Re-render complex views when switching to them
    if (tab === 'analytics') renderAnalytics();
    if (tab === 'calendar') renderCalendar();
}

// ==================== EVENT HANDLERS (Called via HTML onclick) ====================

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginUsername').value; 
    const password = document.getElementById('loginPassword').value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        alert(`Login Failed: ${error.message}`);
    }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
        alert('Account created successfully! Please login.');
        showLogin();
    } catch (error) {
        alert(`Registration Failed: ${error.message}`);
    }
});

document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const seats = parseInt(document.getElementById('eventSeats').value);
    const eventData = {
        name: document.getElementById('eventName').value,
        date: document.getElementById('eventDate').value,
        venue: document.getElementById('eventVenue').value,
        seats: seats,
        availableSeats: seats,
        price: parseFloat(document.getElementById('eventPrice').value),
        created: serverTimestamp()
    };
    try {
        await addDoc(collection(db, 'events'), eventData);
        e.target.reset();
        alert('✅ Event created successfully!');
    } catch (error) {
        console.error("Error creating event: ", error);
        alert('Failed to create event.');
    }
});

document.getElementById('idCardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idCardData = {
        name: document.getElementById('idName').value,
        role: document.getElementById('idRole').value,
        eventAccessId: document.getElementById('idEventAccess').value,
        eventAccess: document.getElementById('idEventAccess').options[document.getElementById('idEventAccess').selectedIndex].text,
        contact: document.getElementById('idContact').value,
        issuedDate: serverTimestamp()
    };
    try {
        await addDoc(collection(db, 'idcards'), idCardData);
        e.target.reset();
        alert('🆔 ID Card issued successfully!');
    } catch (error) {
        console.error("Error issuing ID card: ", error);
        alert('Failed to issue ID card.');
    }
});

// ==================== CORE APPLICATION LOGIC ====================

async function deleteEvent(id) {
    if (!confirm('🛑 WARNING: Deleting this event is permanent and DOES NOT automatically refund/delete associated tickets. Proceed?')) return;
    try {
        await deleteDoc(doc(db, 'events', id));
        alert('🗑️ Event deleted successfully!');
    } catch (error) {
        console.error("Error removing event: ", error);
        alert('Failed to delete event.');
    }
}

// ===============================================
// THIS IS THE CORRECTED FUNCTION
// ===============================================
async function cancelTicket(id, eventId, quantity) {
    if (!confirm(`Are you sure you want to cancel ${quantity} ticket(s)? This will refund the amount and release the seats.`)) return;

    try {
        await runTransaction(db, async (transaction) => {
            const ticketRef = doc(db, 'tickets', id);
            const eventRef = doc(db, 'events', eventId);
            
            // 1. READ FIRST: Get the event document to check seats
            const eventDoc = await transaction.get(eventRef);
            if (!eventDoc.exists()) throw new Error("Event for ticket refund does not exist!");
            
            // 2. WRITE (UPDATE): Calculate new seat count
            const newAvailableSeats = eventDoc.data().availableSeats + quantity;
            transaction.update(eventRef, { availableSeats: newAvailableSeats });
            
            // 3. WRITE (DELETE): Delete the ticket
            transaction.delete(ticketRef);
        });

        alert('✅ Ticket successfully cancelled and seats released!');
    } catch (error) {
        console.error("Error cancelling ticket: ", error);
        // Show the specific error message from the transaction
        alert(`❌ Failed to cancel ticket: ${error.message}`);
    }
}
// ===============================================
// END OF CORRECTED FUNCTION
// ===============================================


// ==================== PAYMENT GATEWAY LOGIC ====================

function initiatePayment() {
    const form = document.getElementById('ticketForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    
    const eventId = document.getElementById('ticketEvent').value;
    const event = events.find(e => e.id === eventId);
    const quantity = parseInt(document.getElementById('ticketQuantity').value);
    
    if (!event) {
        alert('Booking failed: Please select a valid event.');
        return;
    }
    
    if (event.availableSeats < quantity) {
        alert(`Booking failed: Insufficient seats (${event.availableSeats} available).`);
        return;
    }
    
    const totalPrice = event.price * quantity;

    pendingTicketData = {
        eventId,
        event,
        quantity,
        totalPrice,
        attendee: document.getElementById('attendeeName').value,
        email: document.getElementById('attendeeEmail').value,
    };

    document.getElementById('paymentAmount').textContent = `₹${totalPrice.toFixed(2)}`;
    document.getElementById('paymentModal').classList.remove('hidden');
}

function closePaymentModal() {
     document.getElementById('paymentModal').classList.add('hidden');
     pendingTicketData = null;
}

async function processPayment() {
    alert("💳 Processing payment... (Fake 3 seconds delay)");
    await new Promise(resolve => setTimeout(resolve, 3000)); 
    
    if (!pendingTicketData) {
        alert("Payment error: Booking data lost.");
        closePaymentModal();
        return;
    }

    const { eventId, event, quantity, totalPrice, attendee, email } = pendingTicketData;

    try {
        await runTransaction(db, async (transaction) => {
            const eventRef = doc(db, 'events', eventId);
            
            // 1. READ FIRST
            const eventDoc = await transaction.get(eventRef);
            if (!eventDoc.exists()) throw new Error("Event not found!");
            
            const currentSeats = eventDoc.data().availableSeats;
            if (currentSeats < quantity) {
                throw new Error(`Insufficient seats. Only ${currentSeats} available.`);
            }

            // 2. WRITE (UPDATE)
            const newAvailableSeats = currentSeats - quantity;
            transaction.update(eventRef, { availableSeats: newAvailableSeats });

            // 3. WRITE (SET)
            const ticketData = {
                eventId,
                eventName: event.name,
                eventDate: event.date,
                venue: event.venue,
                attendee,
                email,
                quantity,
                totalPrice,
                bookingTime: serverTimestamp()
            };
            
            const newTicketRef = doc(collection(db, 'tickets'));
            transaction.set(newTicketRef, ticketData);
        });

        document.getElementById('ticketForm').reset();
        alert(`🎉 Success! Ticket booked! Total: ₹${totalPrice.toFixed(2)}`);
        closePaymentModal();

    } catch (error) {
        console.error("Transaction failed:", error);
        alert(`❌ Booking Failed (Transaction Rolled Back): ${error.message}`);
        closePaymentModal();
    }
}

// ==================== UI RENDERING FUNCTIONS ====================

function updateAllUI() {
    if (document.getElementById('totalEvents')) {
        updateStats();
        renderEvents();
        renderTickets();
        renderIdCards(); 
        updateEventSelects();
        
        if (document.getElementById('analyticsTab')?.classList.contains('active')) renderAnalytics();
        if (document.getElementById('calendarTab')?.classList.contains('active')) renderCalendar();
    }
}

function updateStats() {
    const totalRevenue = tickets.reduce((sum, t) => sum + t.totalPrice, 0);
    
    document.getElementById('totalEvents').textContent = events.length;
    document.getElementById('totalTickets').textContent = tickets.length;
    document.getElementById('totalRevenue').textContent = `₹${totalRevenue.toFixed(2)}`;
}

function renderAnalytics() {
    const container = document.getElementById('analyticsSummary');
    const activityContainer = document.getElementById('recentActivity');
    if (!container || !activityContainer) return;

    const totalRevenue = tickets.reduce((sum, t) => sum + t.totalPrice, 0);
    
    const totalSeats = events.reduce((sum, e) => sum + (e.seats || 0), 0);
    const seatsBooked = tickets.reduce((sum, t) => sum + (t.quantity || 0), 0);
    const bookingRate = totalSeats > 0 ? ((seatsBooked / totalSeats) * 100).toFixed(1) : 0;
    
    container.innerHTML = `
        <p><strong>Total Revenue Generated:</strong> ₹${totalRevenue.toFixed(2)}</p>
        <p><strong>Total Seats Across All Events:</strong> ${totalSeats}</p>
        <p><strong>Total Seats Booked:</strong> ${seatsBooked}</p>
        <p><strong>Overall Booking Rate:</strong> ${bookingRate}%</p>
        <p><strong>Events with Seats Remaining:</strong> ${events.filter(e => e.availableSeats > 0).length}</p>
    `;
    
    activityContainer.innerHTML = tickets.slice(0, 5).map(t => `
        <div style="padding: 10px; border-bottom: 1px solid #eee; font-size: 0.9em;">
            <strong>${t.attendee}</strong> booked ${t.quantity} ticket(s) for <strong>${t.eventName}</strong> (₹${t.totalPrice.toFixed(2)})
            <span style="float: right; color: #999;">${t.bookingTime ? new Date(t.bookingTime.toDate()).toLocaleTimeString() : 'N/A'}</span>
        </div>
    `).join('') || '<div class="empty-state"><p>No recent bookings.</p></div>';
}

function renderCalendar() {
    const container = document.getElementById('calendarView');
    if (!container) return;

    if (events.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No upcoming events to display.</p></div>';
        return;
    }

    let calendarHTML = '';
    
    events.forEach(e => {
        calendarHTML += `
            <div class="event-item" style="margin-bottom: 20px;">
                <h3 style="color: #667eea;">📅 ${e.date}</h3>
                <p><strong>Event:</strong> ${e.name}</p>
                <p><strong>Venue:</strong> ${e.venue}</p>
                <p><strong>Available:</strong> ${e.availableSeats} seats</p>
            </div>
        `;
    });

    container.innerHTML = calendarHTML;
}

function renderEvents() {
    const container = document.getElementById('eventsList');
    if (!container) return;

    if (events.length === 0) {
        container.innerHTML = '<div class="empty-state">📭<p>No events yet</p></div>';
        return;
    }
    
    container.innerHTML = events.map(e => `
        <div class="event-item">
            <h3>${e.name}</h3>
            <p><strong>📅 Date:</strong> ${e.date}</p>
            <p><strong>📍 Venue:</strong> ${e.venue}</p>
            <p><strong>💺 Available Seats:</strong> ${e.availableSeats} / ${e.seats}</p>
            <p><strong>💵 Price:</strong> ₹${e.price ? e.price.toFixed(2) : '0.00'}</p>
            <div class="event-actions">
                <button class="btn btn-danger btn-small" onclick="deleteEvent('${e.id}')">Delete Event</button>
            </div>
        </div>
    `).join('');
}

function renderTickets() {
    const container = document.getElementById('ticketsList');
    if (!container) return;

    if (tickets.length === 0) {
        container.innerHTML = '<div class="empty-state">🎫<p>No tickets booked</p></div>';
        return;
    }
    
    container.innerHTML = tickets.map(t => {
        const bookingTimeString = t.bookingTime ? new Date(t.bookingTime.toDate()).toLocaleString() : 'N/A';
        return `
            <div class="ticket-card" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white;">
                <p style="font-size: 1.5em; font-weight: bold;">Ticket for ${t.eventName}</p>
                <p><strong>Attendee:</strong> ${t.attendee}</p>
                <p><strong>Quantity:</strong> ${t.quantity} ticket(s)</p>
                <p><strong>Total Paid:</strong> ₹${t.totalPrice ? t.totalPrice.toFixed(2) : '0.00'}</p>
                <p style="font-size: 0.9em; margin-top: 10px;">Booked: ${bookingTimeString}</p>
                <div class="event-actions" style="margin-top: 10px; padding: 0;">
                    <button class="btn btn-danger btn-small" style="width: 150px; background: #f093fb;" onclick="cancelTicket('${t.id}', '${t.eventId}', ${t.quantity})">Cancel Ticket</button>

                </div>
            </div>
        `;
    }).join('');
}

function renderIdCards() {
    const container = document.getElementById('idCardsList');
    if (!container) return;

    if (idCards.length === 0) {
        container.innerHTML = '<div class="empty-state">🆔<p>No ID cards issued</p></div>';
        return;
    }
    
    container.innerHTML = idCards.map(card => {
        const issuedDateString = card.issuedDate ? new Date(card.issuedDate.toDate()).toLocaleString() : 'N/A';

        return `
            <div class="id-card">
                <div class="id-header">
                    <h3 style="color: white; margin: 0;">EVENT ID CARD</h3>
                </div>
                <div class="id-photo">👤</div>
                <div class="id-info">
                    <h3>${card.name}</h3>
                    <p><strong>ID:</strong> ${card.id.substring(0, 5)}...</p>
                    <p><strong>Role:</strong> ${card.role}</p>
                    <p><strong>Event Access:</strong> ${card.eventAccess}</p>
                    <p><strong>Contact:</strong> ${card.contact}</p>
                    <div class="qr-code" id="qrcode-${card.id}"></div>
                    <p style="font-size: 0.85em; color: #999;">Issued: ${issuedDateString}</p>
                    <button class="btn btn-primary btn-small" onclick="printIdCard('${card.id}')" style="margin-top: 15px;">🖨️ Print Card</button>
                </div>
            </div>
        `;
    }).join('');

    // QR Code Generation
    setTimeout(() => {
        idCards.forEach(card => {
            const qrElement = document.getElementById(`qrcode-${card.id}`);
            // Check if QRCode function exists (from CDN) and element is in DOM
            if (qrElement && typeof QRCode !== 'undefined') {
                const qrData = `ID:${card.id}|Role:${card.role}|EventID:${card.eventAccessId}`; 
                
                new QRCode(qrElement, {
                    text: qrData,
                    width: 100,
                    height: 100,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            }
        });
    }, 50); // Small delay to ensure DOM is updated
}

function updateEventSelects() {
    const ticketSelect = document.getElementById('ticketEvent');
    const idSelect = document.getElementById('idEventAccess');
    if (!ticketSelect || !idSelect) return;

    ticketSelect.innerHTML = '<option value="">Choose an event</option>' + 
        events.map(e => `<option value="${e.id}">${e.name} - ${e.date} (₹${e.price ? e.price.toFixed(2) : '0.00'})</option>`).join('');
    
    idSelect.innerHTML = '<option value="">Select Event</option>' + 
        events.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
}

function printIdCard(id) {
    alert(`Printing ID Card for ${id}. This typically opens a new window with a printable format.`);
}

// ==================== STARTUP ATTACHMENTS ====================
// This ensures HTML onclick="" attributes can find the modular functions
document.addEventListener('DOMContentLoaded', () => {
     window.showRegister = showRegister;
     window.showLogin = showLogin;
     window.logout = logout;
     window.switchTab = switchTab;
     window.deleteEvent = deleteEvent;
     window.cancelTicket = cancelTicket;
     window.initiatePayment = initiatePayment;
     window.processPayment = processPayment;
     window.closePaymentModal = closePaymentModal;
     window.printIdCard = printIdCard;
});
