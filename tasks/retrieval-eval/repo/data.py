"""A small help-centre corpus and labelled queries for trying the retriever by hand."""

DOCUMENTS = {
    "a1": "How to request a refund. Refunds are issued to the original payment method within five days.",
    "a2": "Change your password from the account settings page. Passwords must be twelve characters.",
    "a3": "Shipping times. Standard shipping takes three to five days. Express shipping takes one day.",
    "a4": "Our refund policy: items can be returned within thirty days. Shipping costs are not refunded.",
    "a5": "Reset a forgotten password using the link on the sign-in page. The link expires after one hour.",
    "a6": "Track your order from the orders page. Tracking updates may take a day to appear after shipping.",
    "a7": "Contact support by email or chat. Chat is open on weekdays.",
    "a8": "Update your payment method in billing settings. We accept cards and bank transfer.",
}

# Each query lists the ids of the articles a support agent marked as relevant.
DATASET = [
    {"query": "How do I get a refund?", "relevant": ["a1", "a4"]},
    {"query": "forgot my password", "relevant": ["a5", "a2"]},
    {"query": "How long does shipping take?", "relevant": ["a3"]},
    {"query": "Where is my order?", "relevant": ["a6"]},
    {"query": "change payment card", "relevant": ["a8"]},
]
