from django.conf import settings
from .models import Announcement


def common_settings(request):
    return {
        'STAGING': settings.STAGING,
        'DEBUG': settings.DEBUG
    }


def announcements(request):
    """Add active announcements for the current path to the context"""
    current_announcements = []
    if hasattr(request, 'path'):
        current_announcements = Announcement.get_active_for_path(request.path)

    return {
        'announcements': current_announcements
    }
